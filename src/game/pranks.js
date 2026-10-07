// Race pranks from the chat line, and what they do to the cars:
//  /missile         a roof launcher for 10 s that locks onto every car it can see
//                   and fires homing missiles; a hit sends that car back to its
//                   last checkpoint
//  /pitstop <name>  that car sits out 10 s in a botched pit stop and drives the
//                   rest of the race on a tiny spare (pulls, wobbles, less grip)
//  /yeet <name>     that car sits out 30 s (swatted to Mars by a cat)
//  /superyeet <name> sits out 60 s (punched to Pluto; once per race)
//  /fly             your own car grows wings and flies for 10 s
//  /pitstop pro     your own car sits out a 6 s pit stop done right and comes out
//                   on gold tyres: much more grip and power (once per race)
//  /pitstopnuke <name>  their wheels are blown off and four wrong ones go on:
//                   slow and nearly undrivable (once per race)
//  /1v1 <name>      you and them in a build-and-shoot duel (against an AI, a bot
//                   fights for it); the loser gets the 120 s omega yeet
//  /fullbox <name>  walls and a roof go up round that car, a shot, and it's a
//                   wreck to be rebuilt
// Every client runs the same pranks from the host's messages. Whoever drives a
// car decides what happens to it: the victim's own client, or the host for its
// AI. The films themselves are src/game/scenes/.
import * as THREE from 'three';
import { h } from '../ui/dom.js';
import { clamp, mulberry32, smoothstep } from '../util/math.js';
import { TYRES, tyreSpec, tyreLook } from './tyres.js';
import { Quiz, Rebuild, makeQuestion, QUIZ_TIME } from './wreck.js';
import { makeWings, animateWings, FLY_TIME } from './fly.js';
import { Duel } from './duel.js';

export const MISSILE_TIME = 10;
export const PITSTOP_TIME = 10;
export const YEET_TIME = 30;
export const AD_TIME = 30;
export const SUPERYEET_TIME = 60;
export const PITPRO_TIME = 6;
export const OMEGA_TIME = 120;
const BOX_SHOT = 1.25; // walls up, then the shot
export const AI_REBUILD = 25; // an AI's rebuild takes this long
const BURN_TIME = 6; // wrong answer -> boom
const RANGE = 320, FIRE_EVERY = 0.45, SEE = Math.cos((80 * Math.PI) / 180);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _f = new THREE.Vector3(), _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const hit = {};

// "rook", "Rook (AI)", "ro" -> the entry, or a list of names if it's unclear
export function findCar(session, name, notId) {
  const clean = (s) => String(s || '').toLowerCase().replace(/\s*\(ai\)\s*$/, '').trim();
  const q = clean(name);
  const cars = session.entries.filter((e) => e.kind !== 'ghost' && e.id !== notId);
  if (!q) return { list: cars.map((e) => e.name.replace(/\s*\(AI\)$/, '')) };
  const exact = cars.filter((e) => clean(e.name) === q);
  const pre = exact.length ? exact : cars.filter((e) => clean(e.name).startsWith(q));
  const any = pre.length ? pre : cars.filter((e) => clean(e.name).includes(q));
  if (any.length === 1) return { car: any[0] };
  return { list: (any.length ? any : cars).map((e) => e.name.replace(/\s*\(AI\)$/, '')) };
}

export class Pranks {
  constructor(session) {
    this.s = session;
    this.app = session.app;
    this.launchers = new Map(); // car id -> launcher
    this.missiles = [];
    this.booms = [];
    this.rnd = mulberry32((Date.now() & 0xffff) ^ 0x77);
    this.ui = h('div.pranks', this.armedEl = h('div.pk-armed'), this.warnEl = h('div.pk-warn', '⚠ MISSILE LOCKED ON YOU'));
    this.locks = [];
    this.wings = new Map(); // car id -> {g, t}
    this.boxes = [];
    this.planks = [];
    this.fx = []; // little one-off effects: (dt) => true when finished
    this.woodMats = [0xb8834a, 0xa06a38, 0xc8945a].map((c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true }));
    this.tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff0a0).multiplyScalar(3), transparent: true });
    this.radMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9aff4a).multiplyScalar(2.4), transparent: true });
    this.flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa040).multiplyScalar(3) });
    this.boomMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb050).multiplyScalar(2.6), transparent: true });
  }

  // ---- /missile ----------------------------------------------------------------------
  arm(byId) {
    const e = this.s.entries.find((x) => x.id === byId);
    if (!e) return;
    const old = this.launchers.get(byId);
    if (old) { old.t = Math.min(old.t, 0.5); return; }
    const g = new THREE.Group();
    const dark = new THREE.MeshLambertMaterial({ color: 0x3a3d44, flatShading: true });
    const olive = new THREE.MeshLambertMaterial({ color: 0x5a6a44, flatShading: true });
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.2, 0.9), dark));
    const turret = new THREE.Group();
    turret.position.y = 0.35;
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.5, 1.2), olive);
    turret.add(pod);
    for (const [x, y] of [[-0.22, 0.12], [0.22, 0.12], [-0.22, -0.12], [0.22, -0.12]]) {
      const tubeM = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 8), new THREE.MeshBasicMaterial({ color: 0x111111 }));
      tubeM.rotation.x = Math.PI / 2; tubeM.position.set(x, y, 0.62);
      turret.add(tubeM);
    }
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.97, 0.08, 1.22), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3a2a).multiplyScalar(1.6) }));
    turret.add(stripe);
    g.add(turret);
    // sit it on the roof
    const box = new THREE.Box3().setFromObject(e.model.body);
    const roof = box.max.y - e.model.group.position.y;
    g.userData.roof = roof;
    g.position.set(0, roof - 0.4, -0.2);
    e.model.group.add(g);
    // only the car's own driver picks targets and fires; everyone sees the shots
    this.launchers.set(byId, { e, g, turret, t: 0, next: 0.6, mine: !!e.car && e === this.s.player, aim: null });
    if (e === this.s.player) this.app.audio.play('lock');
  }

  // the launcher's owner picks a target: the nearest car it can see
  pick(l) {
    const s = this.s, car = l.e.car;
    const from = _a.copy(car.pos).addScaledVector(car.up, 1.4);
    const busy = new Set(this.missiles.filter((m) => m.by === l.e.id).map((m) => m.target.id));
    let best = null, bd = RANGE;
    for (const o of s.entries) {
      if (o === l.e || o.kind === 'ghost' || o.out || o.race.finished || !o.model.group.visible || busy.has(o.id) || s.ghosted(o)) continue;
      const p = o.model.group.position;
      const d = p.distanceTo(from);
      if (d > bd || d < 4) continue;
      _b.copy(p).sub(from).divideScalar(d);
      if (_b.dot(car.fwd) < SEE) continue; // behind it
      if (s.world.raycast(from.x, from.y, from.z, _b.x, _b.y, _b.z, d - 3, hit)) continue; // a wall or a hill in the way
      best = o; bd = d;
    }
    return best;
  }

  launch(byId, targetId, p, v) {
    const target = this.s.entries.find((x) => x.id === targetId);
    if (!target) return;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.3, 8), new THREE.MeshLambertMaterial({ color: 0xf2f2f2, flatShading: true }));
    body.rotation.x = Math.PI / 2;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.35, 8), new THREE.MeshLambertMaterial({ color: 0xe8433a, flatShading: true }));
    nose.rotation.x = Math.PI / 2; nose.position.z = 0.82;
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.7, 8, 1, true), this.flameMat);
    flame.rotation.x = -Math.PI / 2; flame.position.z = -1;
    g.add(body, nose, flame);
    g.position.copy(p);
    this.s.renderer.scene.add(g);
    this.missiles.push({ by: byId, target, g, p: p.clone(), v: v.clone(), age: 0, puff: 0 });
    this.app.audio.play('missile');
  }

  // ---- /pitstop and /yeet: sit a car out ------------------------------------------------
  sendOut(targetId, kind, secs) {
    const e = this.s.entries.find((x) => x.id === targetId);
    if (!e || e.out) return null;
    e.out = { kind, until: this.s.time + secs };
    e.model.group.visible = false;
    if (e.car) { e.car.vel.set(0, 0, 0); e.car.angVel.set(0, 0, 0); }
    return e;
  }

  release(e) {
    const s = this.s, kind = e.out.kind;
    e.out = null;
    e.model.group.visible = true;
    if (e.car) {
      // back on the road where it left it, from a standstill
      const r = e.limits.placement('flip', e.prog, s.loaded.speeds);
      e.car.reset(r.pos, r.quat, kind === 'pitpro' ? 26 : 0); // a pro stop launches you out
      e.prevPos.copy(r.pos); e.prevQuat.copy(r.quat);
      e.prog.reset(r.index ?? e.prog.index);
      e.prog.update(e.car.pos);
      e.limits.reset();
      e.ghostUntil = s.clock + 2;
      if (e === s.focus) s.camera.snap(s._camTarget(e));
    }
    if (kind === 'duel' && e === s.player && !this.duelGame?.over) this.closeDuel(); // (it timed out)
    if (kind === 'pitstop') this.setTyres(e, 'spare');
    if (kind === 'pitpro') { this.setTyres(e, 'pro'); if (e.car) e.car.boost = Math.max(e.car.boost || 0, 1.35); }
    if (kind === 'wreck') { e.fx = 0; if (e.car && e.burnSpec) { e.car.spec = e.burnSpec; e.burnSpec = null; } }
    if (e === s.player && this.app.cutscene && !this.app.cutscene.pauses) this.app.endFilm(); // your car's back: so are you
    if (e === s.player) s.message({ yeet: 'BACK FROM MARS', superyeet: 'BACK FROM PLUTO', pitpro: 'PRO TYRES ON', duel: 'YOU WON THE 1V1', omega: 'BACK FROM DAGESTAN', wreck: 'REBUILT - GO GO GO', advertisement: 'THANKS FOR WATCHING' }[kind] || 'OUT OF THE PITS - HANDLING DAMAGED', 'warn', 2.5);
  }

  // ---- /crash ---------------------------------------------------------------------------
  // A big crash, seen by everyone; the car's own driver throws it, and it ends up
  // a burning wreck to be rebuilt.
  crash(targetId, msg = 'YOU CRASHED') {
    const s = this.s, e = s.entries.find((x) => x.id === targetId);
    if (!e || e.out) return;
    this.foldWings(e.id);
    this.boom(e.model.group.position, 1.6);
    e.boomedAt = s.clock; // (the wreck's fire, when it syncs, doesn't go boom again)
    if (!e.car) return;
    const car = e.car;
    car.vel.multiplyScalar(0.5).add(_a.set((Math.random() - 0.5) * 10, 16, (Math.random() - 0.5) * 10)).addScaledVector(car.fwd, 6);
    car.angVel.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 14);
    e.ghostUntil = 0;
    e.fx = 2;
    e.wreckAt = s.clock + 2.4; // let it tumble, then it's a wreck
    if (e === s.player) s.message(msg, 'warn', 2.4);
  }

  // ---- /fly --------------------------------------------------------------------------------
  // Wings for everyone to see; the car's own driver flies it (session -> flyStep).
  fly(byId) {
    const s = this.s, e = s.entries.find((x) => x.id === byId);
    if (!e || e.out) return;
    let w = this.wings.get(byId);
    if (w) w.t = Math.min(w.t, 0.5); // again: a fresh ten seconds
    else {
      const g = makeWings();
      const box = new THREE.Box3().setFromObject(e.model.body);
      g.position.set(0, (box.max.y - e.model.group.position.y) * 0.72, -0.1);
      e.model.group.add(g);
      w = { e, g, t: 0 };
      this.wings.set(byId, w);
    }
    if (e.car) {
      if (e.flight) e.flight.t = w.t;
      else e.flight = { t: 0, yaw: Math.atan2(e.car.fwd.x, e.car.fwd.z), speed: clamp(e.car.forwardSpeed, 30, 72), bank: 0 };
    }
    if (e === s.focus || e.model.group.position.distanceTo(s.renderer.camera.position) < 120) this.app.audio.play('wings');
    if (e === s.player) s.message('YOU CAN FLY', 'go', 1.6);
  }

  foldWings(id) {
    const w = this.wings.get(id);
    if (w && w.t < FLY_TIME - 0.4) w.t = FLY_TIME - 0.4;
  }

  // ---- /fullbox ----------------------------------------------------------------------------
  // Four walls and a roof slam up round the car (it's stuck), then the shot from
  // whoever called it: 200, the walls blow apart, and it's a wreck to rebuild.
  fullbox(byId, targetId) {
    const s = this.s, e = s.entries.find((x) => x.id === targetId);
    if (!e || e.out || e.boxed) return;
    const by = s.entries.find((x) => x.id === byId) || null;
    this.foldWings(e.id);
    if (e.car) { e.flight = null; e.boxed = true; e.car.vel.set(0, 0, 0); e.car.angVel.set(0, 0, 0); }
    const fwd = _f.set(0, 0, 1).applyQuaternion(e.model.group.quaternion);
    const g = new THREE.Group();
    g.rotation.y = Math.atan2(fwd.x, fwd.z);
    const S = 6.4, H = 3.6, T = 0.3;
    const pieces = [];
    const wall = (x, z, ry, i) => {
      const w = new THREE.Group();
      w.position.set(x, 0, z); w.rotation.y = ry;
      for (let k = 0; k < 4; k++) { const p = new THREE.Mesh(new THREE.BoxGeometry(S, H / 4 - 0.06, T), this.woodMats[(k + i) % 3]); p.position.y = (k + 0.5) * (H / 4); w.add(p); pieces.push(p); }
      for (const px of [-S / 2, S / 2]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.34, H, 0.4), this.woodMats[2]); p.position.set(px, H / 2, 0); w.add(p); pieces.push(p); }
      w.scale.y = 0.01; w.visible = false;
      g.add(w);
      return w;
    };
    const parts = [wall(0, S / 2, 0, 0), wall(S / 2, 0, Math.PI / 2, 1), wall(0, -S / 2, 0, 2), wall(-S / 2, 0, Math.PI / 2, 0)];
    const roof = new THREE.Group();
    const RW = (S + 0.4) / 5;
    for (let k = 0; k < 5; k++) { const p = new THREE.Mesh(new THREE.BoxGeometry(S + 0.4, 0.24, RW - 0.05), this.woodMats[k % 3]); p.position.z = (k - 2) * RW; roof.add(p); pieces.push(p); }
    roof.position.y = H + 0.1; roof.visible = false; roof.scale.set(0.01, 1, 0.01);
    g.add(roof);
    parts.push(roof);
    s.renderer.scene.add(g);
    this.boxes.push({ e, by, g, parts, pieces, t: 0, shot: false });
    if (e === s.player) s.message('BOXED IN', 'warn', 1.3);
  }

  // the shot: a tracer from the caller, 200, planks everywhere, a crash
  snipe(b) {
    const s = this.s, e = b.e, cam = s.renderer.camera;
    e.boxed = null;
    const to = e.model.group.position.clone(); to.y += 0.8;
    const src = b.by && b.by !== e && b.by.model.group.visible && !b.by.out ? b.by.model.group.position : null;
    const from = src ? src.clone().add(_c.set(0, 1.5, 0)) : to.clone().add(_c.set(-40, 30, -50));
    const len = Math.max(1, from.distanceTo(to));
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, len, 5, 1, true), this.tracerMat.clone());
    tr.position.copy(from).add(to).multiplyScalar(0.5);
    tr.quaternion.setFromUnitVectors(UP, _a.copy(to).sub(from).divideScalar(len));
    s.renderer.scene.add(tr);
    let age = 0;
    this.fx.push((dt) => { age += dt; tr.material.opacity = 1 - age / 0.35; if (age < 0.35) return false; s.renderer.scene.remove(tr); tr.geometry.dispose(); tr.material.dispose(); return true; });
    this.app.audio.play('snipe');
    // the walls blow outward, plank by plank
    b.g.updateMatrixWorld(true);
    const c = b.g.position.clone(); c.y += 1.8;
    for (const p of b.pieces) {
      s.renderer.scene.attach(p);
      const out = p.position.clone().sub(c); out.y = Math.max(0.3, out.y);
      out.normalize();
      this.planks.push({ m: p, v: out.multiplyScalar(9 + Math.random() * 9).add(_a.set(0, 4 + Math.random() * 5, 0)), w: _b.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14).clone(), age: 0 });
    }
    s.renderer.scene.remove(b.g);
    // 200 over the car, for everyone who can see it
    const dmg = h('div.fb-dmg', '200');
    this.ui.append(dmg);
    let da = 0;
    this.fx.push((dt) => {
      da += dt;
      _a.copy(e.model.group.position); _a.y += 2.2 + da * 1.5;
      _a.project(cam);
      dmg.style.display = _a.z > 1 ? 'none' : '';
      dmg.style.transform = `translate(${((_a.x * 0.5 + 0.5) * innerWidth).toFixed(0)}px, ${((-_a.y * 0.5 + 0.5) * innerHeight).toFixed(0)}px) translate(-50%, -50%) scale(${(1 + Math.max(0, 0.25 - da) * 3).toFixed(2)})`;
      dmg.style.opacity = String(Math.min(1, (1.6 - da) * 2));
      if (da < 1.6) return false;
      dmg.remove();
      return true;
    });
    const byName = (b.by?.name || 'Someone').replace(/\s*\(AI\)$/, '');
    const name = e.name.replace(/\s*\(AI\)$/, '');
    if (b.by && b.by === s.player) {
      // the caller's screen: a hitmarker and the callout
      const hm = h('div.fb-hit'), call = h('div.fb-call', h('b', 'CLIPPED'), h('span', `you fullboxed ${name}`));
      this.ui.append(hm, call);
      this.app.audio.play('hitmark');
      setTimeout(() => hm.remove(), 450);
      setTimeout(() => call.remove(), 2600);
    }
    this.crash(e.id, `${byName.toUpperCase()} FULLBOXED YOU`);
  }

  // ---- /1v1 --------------------------------------------------------------------------------
  // Both cars sit out while the caller and the target fight it out: two players
  // over the network, or a player and a bot standing in for an AI. The referee
  // (the target, or the caller when the target's an AI) reports the result through
  // app.duelResult; a duel that never ends lets them go after a minute.
  duel(byId, targetId) {
    const s = this.s;
    const a = s.entries.find((x) => x.id === byId), b = s.entries.find((x) => x.id === targetId);
    if (!a || !b || a === b || a.out || b.out) return;
    for (const e of [a, b]) this.sendOut(e.id, 'duel', 60);
    const me = s.player;
    if (me !== a && me !== b) return;
    const foe = me === a ? b : a;
    const mine = { name: 'You', color: me.custom?.paint || '#e8433a' };
    const theirs = { name: foe.name.replace(/\s*\(AI\)$/, ''), color: foe.custom?.paint || '#3a6ae8' };
    if (theirs.color.toLowerCase() === mine.color.toLowerCase()) theirs.color = mine.color.toLowerCase() === '#3a6ae8' ? '#e8433a' : '#3a6ae8'; // tell them apart
    // (online an AI is a 'remote' car on a guest's screen: it's known by its id and name)
    const person = !(foe.kind === 'bot' || (String(foe.id).startsWith('bot') && / \(AI\)$/.test(foe.name)));
    const link = person ? { send: (d) => this.app.net?.duelSend(foe.id, d) } : null;
    this.app.ui.hudLayer.classList.add('cinema');
    this.duelGame = new Duel(this.app, { me: mine, foe: theirs, link, referee: !person || me === b }, (won, report) => {
      this.duelGame = null;
      this.app.ui.hudLayer.classList.remove('cinema');
      if (report) this.app.duelResult(byId, targetId, won ? me.id : foe.id);
    });
    this.duelGame.foeId = foe.id;
  }

  closeDuel() {
    if (!this.duelGame) return;
    this.duelGame.dispose();
    this.duelGame = null;
    this.app.ui.hudLayer.classList.remove('cinema');
  }

  // lost: out for the length of the film
  omega(targetId) {
    const s = this.s, e = s.entries.find((x) => x.id === targetId);
    if (!e) return null;
    e.out = { kind: 'omega', until: s.time + OMEGA_TIME };
    e.model.group.visible = false;
    if (e.car) { e.car.vel.set(0, 0, 0); e.car.angVel.set(0, 0, 0); }
    return e;
  }

  // ---- /precalc -------------------------------------------------------------------------
  // The car's own driver answers; a human sees the quiz, an AI guesses.
  quiz(targetId) {
    const s = this.s, e = s.entries.find((x) => x.id === targetId);
    if (!e || !e.car || e.out || e.quiz) return;
    const q = makeQuestion();
    if (e === s.player) {
      e.quiz = new Quiz(this.app, q, (ok) => { e.quiz.done = true; this.quizDone(e, ok); });
    } else {
      // the AI thinks it over, then gets it right about two times in three
      e.quiz = { ai: true, at: s.clock + 3 + Math.random() * 5, ok: Math.random() < 0.65, update() {} };
    }
  }

  quizDone(e, ok) {
    const s = this.s;
    setTimeout(() => { if (e.quiz?.done || e.quiz?.ai) e.quiz = null; }, 2400);
    if (e.kind === 'bot' && s.mode !== 'online') this.app.ui.toast(ok ? `${e.name} got the precalc question right` : `${e.name} got it wrong - engine overheating`);
    if (ok) return;
    this.burn(e);
  }

  // wrong answer: smoke, less power, fire, boom
  burn(e) {
    if (!e.car || e.out || e.burn) return;
    e.burn = { t: 0 };
    e.fx = 1;
    e.burnSpec = e.car.spec;
    if (e === this.s.player) this.s.message('ENGINE OVERHEATING', 'warn', 2.5);
  }

  // the car is a wreck: it sits out until it's rebuilt
  wreck(e) {
    const s = this.s;
    e.burn = null;
    e.wreckAt = 0;
    e.fx = 2;
    const human = e === s.player;
    e.out = { kind: 'wreck', until: human ? Infinity : s.time + AI_REBUILD, keep: true };
    e.car.vel.set(0, 0, 0); e.car.angVel.set(0, 0, 0);
    if (human) {
      this.app.ui.hudLayer.classList.add('cinema');
      this.rebuild = new Rebuild(this.app, { paint: e.custom?.paint || '#e8433a' }, () => {
        this.rebuild = null;
        this.app.ui.hudLayer.classList.remove('cinema');
        if (e.out) this.release(e);
      });
    }
  }

  // a fireball (crash, overheat) with sparks and smoke, and its sound
  boom(p, size = 1) {
    const s = this.s;
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), this.boomMat.clone());
    b.position.copy(p);
    b.userData.size = 7 * size;
    s.renderer.scene.add(b);
    this.booms.push({ m: b, age: 0 });
    for (let k = 0; k < 24; k++) s.effects.spark(p, _a.set((Math.random() - 0.5) * 20, Math.random() * 14, (Math.random() - 0.5) * 20));
    for (let k = 0; k < 10; k++) s.effects.puff(_a.copy(p).add(_b.set((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3)), _b.set(0, 2, 0), 1.3 + Math.random(), 0x3a3a3a, 1.8);
    const cd = p.distanceTo(s.renderer.camera.position);
    this.app.audio.play(cd < 160 ? 'blast' : 'blastFar');
    if (cd < 80) s.camera.shake = Math.max(s.camera.shake, 1.5 * (1 - cd / 80));
  }

  // smoke and fire on cars that are overheating (1) or wrecked (2), local or remote
  fires(dt) {
    const s = this.s;
    for (const e of s.entries) {
      const fx = e.car ? e.fx || 0 : e.remoteFx || 0;
      if (e.kind === 'remote' && fx === 2 && e.lastFx !== 2 && !(s.clock - (e.boomedAt ?? -9) < 4)) this.boom(e.model.group.position, 1.3);
      e.lastFx = fx;
      if (e.tyres === 'pro' && e.model.group.visible && Math.random() < dt * 10) {
        const w = e.model.wheels[(Math.random() * 4) | 0];
        const sp = e.car ? e.car.speed : e.vel ? e.vel.length() : 0;
        if (sp > 12) s.effects.spark(w.spin.getWorldPosition(_c), _b.set((Math.random() - 0.5) * 2, 1 + Math.random() * 2, (Math.random() - 0.5) * 2));
      }
      // junk tyres smoke, and the square one scrapes
      if (e.tyres === 'junk' && e.model.group.visible) {
        const sp = e.car ? e.car.speed : e.vel ? e.vel.length() : 0;
        if (sp > 6 && Math.random() < dt * 9) s.effects.puff(e.model.wheels[(Math.random() * 4) | 0].spin.getWorldPosition(_c), _b.set((Math.random() - 0.5), 1, (Math.random() - 0.5)), 0.5, 0x8a8a8a, 1.1);
        if (sp > 6 && Math.random() < dt * 14) s.effects.spark(e.model.wheels[0].spin.getWorldPosition(_c), _b.set((Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3));
      }
      if (!fx || !e.model.group.visible) continue;
      const g = e.model.group, p = _c.copy(g.position);
      const fwd = _f.set(0, 0, 1).applyQuaternion(g.quaternion);
      if (fx === 1) {
        // smoke from under the bonnet, thicker and darker as it goes
        const k = e.burn ? Math.min(1, e.burn.t / BURN_TIME) : 0.5;
        if (Math.random() < dt * (10 + 20 * k)) s.effects.puff(_a.copy(p).addScaledVector(fwd, 1.4).add(_b.set(0, 0.7, 0)), _b.set((Math.random() - 0.5), 2 + k * 2, (Math.random() - 0.5)), 0.5 + k * 0.9, k > 0.5 ? 0x2a2a2a : 0x9a9a9a, 1.4);
        if (k > 0.55 && Math.random() < dt * 16) s.effects.spark(_a.copy(p).addScaledVector(fwd, 1.3).add(_b.set(0, 0.6, 0)), _b.set((Math.random() - 0.5) * 3, 3 + Math.random() * 3, (Math.random() - 0.5) * 3));
      } else {
        // a burning wreck
        if (Math.random() < dt * 22) s.effects.puff(_a.copy(p).add(_b.set((Math.random() - 0.5) * 2, 0.8, (Math.random() - 0.5) * 3)), _b.set((Math.random() - 0.5), 3, (Math.random() - 0.5)), 0.9 + Math.random() * 0.8, 0x1e1e1e, 2.2);
        if (Math.random() < dt * 24) s.effects.spark(_a.copy(p).add(_b.set((Math.random() - 0.5) * 2, 0.5, (Math.random() - 0.5) * 3)), _b.set((Math.random() - 0.5) * 2, 4 + Math.random() * 3, (Math.random() - 0.5) * 2));
      }
    }
  }

  // tyres for the rest of the race (see tyres.js): every client draws them, the
  // car's own driver gets the physics. The latest pit stop wins.
  setTyres(e, kind) {
    tyreLook(e.model, kind);
    e.tyres = kind;
    if (!e.car) return;
    e.baseSpec = e.baseSpec || e.burnSpec || e.car.spec;
    const spec = tyreSpec(e.baseSpec, kind);
    if (e.burnSpec) e.burnSpec = spec; else e.car.spec = spec;
    const t = TYRES[kind];
    e.handicap = t.pull ? { pull: (this.rnd() < 0.5 ? -1 : 1) * t.pull, wobble: t.wobble, drift: t.drift || 0, bumps: !!t.bumps, bump: 0, t: 0 } : null;
  }

  // bad tyres fight the steering (after the driver or AI has set it); a square
  // wheel thumps the car about as well
  steer(e, dt) {
    const hc = e.handicap, car = e.car;
    hc.t += dt;
    const k = clamp(car.speed / 18, 0, 1);
    const pull = hc.pull + Math.sin(hc.t * 0.7) * hc.drift;
    car.input.steer = clamp(car.input.steer + (pull + Math.sin(hc.t * 9.5) * hc.wobble) * k, -1, 1);
    if (hc.bumps && car.grounded && car.speed > 3) {
      hc.bump -= (dt * car.speed) / 4.5;
      if (hc.bump <= 0) {
        hc.bump = 1;
        car.vel.addScaledVector(car.up, 0.9);
        car.angVel.x += (this.rnd() - 0.5) * 0.8;
        car.angVel.z += (this.rnd() - 0.5) * 0.8;
      }
    }
  }

  // ---- /pitstopnuke ------------------------------------------------------------------------
  // A green flash at every wheel, all four fly off, and four wrong ones go on.
  tyreNuke(targetId) {
    const s = this.s, e = s.entries.find((x) => x.id === targetId);
    if (!e || e.out) return;
    const g = e.model.group;
    g.updateMatrixWorld(true);
    for (const w of e.model.wheels) {
      const p = w.spin.getWorldPosition(new THREE.Vector3());
      const f = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), this.radMat.clone());
      f.position.copy(p);
      f.userData.size = 1.5;
      s.renderer.scene.add(f);
      this.booms.push({ m: f, age: 0 });
      for (let k = 0; k < 8; k++) s.effects.spark(p, _a.set((Math.random() - 0.5) * 12, Math.random() * 10, (Math.random() - 0.5) * 12));
      // the old wheel flies off
      const old = new THREE.Mesh(w.spin.geometry, w.spin.material);
      old.position.copy(p);
      old.quaternion.copy(w.spin.getWorldQuaternion(_q));
      old.scale.copy(w.spin.scale);
      s.renderer.scene.add(old);
      const out = p.clone().sub(g.position).setY(0).normalize();
      this.planks.push({ m: old, keep: true, v: out.multiplyScalar(7 + Math.random() * 5).add(_a.set(0, 8 + Math.random() * 5, 0)), w: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(16), age: 0 });
    }
    for (let k = 0; k < 8; k++) s.effects.puff(_a.copy(g.position).add(_b.set((Math.random() - 0.5) * 3, Math.random(), (Math.random() - 0.5) * 3)), _b.set(0, 2, 0), 1 + Math.random(), 0x6a8a4a, 1.6);
    const cd = g.position.distanceTo(s.renderer.camera.position);
    this.app.audio.play(cd < 160 ? 'tyrenuke' : 'blastFar');
    if (cd < 60) s.camera.shake = Math.max(s.camera.shake, 0.8 * (1 - cd / 60));
    this.setTyres(e, 'junk');
    if (e.car) { e.car.vel.addScaledVector(e.car.up, 4); e.car.angVel.x += (Math.random() - 0.5) * 2; e.car.angVel.z += (Math.random() - 0.5) * 2; }
    if (e === s.player) s.message('TYRES NUKED - GOOD LUCK', 'warn', 2.8);
  }

  // ---- time ----------------------------------------------------------------------------
  update(dt) {
    const s = this.s;
    // launchers: rise, aim, fire, sink
    for (const [id, l] of this.launchers) {
      l.t += dt;
      const g = l.g, roof = g.userData.roof;
      g.position.y = roof - 0.4 + 0.55 * smoothstep(0, 0.4, l.t) - 0.55 * smoothstep(MISSILE_TIME, MISSILE_TIME + 0.5, l.t);
      if (l.mine && l.t < MISSILE_TIME && l.e.car && !l.e.out) {
        l.next -= dt;
        if (l.next <= 0) {
          const o = this.pick(l);
          l.next = o ? FIRE_EVERY : 0.15;
          if (o) {
            l.aim = o;
            const p = _c.copy(l.e.car.pos).addScaledVector(l.e.car.up, g.userData.roof + 0.4);
            const dir = _b.copy(o.model.group.position).sub(p).normalize();
            const v = l.e.car.vel.clone().multiplyScalar(0.8).addScaledVector(dir, 22).addScaledVector(UP, 7);
            this.launch(id, o.id, p, v);
            this.app.net?.prankShot?.(id, o.id, p, v);
          }
        }
      }
      // turn the pod toward its target
      if (l.aim && l.aim.model) {
        _a.copy(l.aim.model.group.position);
        l.e.model.group.worldToLocal(_a);
        const yaw = Math.atan2(_a.x, _a.z);
        l.turret.rotation.y += (clamp(yaw, -1.4, 1.4) - l.turret.rotation.y) * Math.min(1, dt * 10);
      }
      if (l.t > MISSILE_TIME + 0.6) { l.e.model.group.remove(g); g.traverse((o) => { o.geometry?.dispose(); }); this.launchers.delete(id); }
    }
    // missiles home in; the car's own driver decides the hit
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.age += dt;
      const T = m.target.car ? m.target.car.pos : m.target.model.group.position;
      const tv = m.target.car ? m.target.car.vel : m.target.vel;
      const speed = Math.min(150, 40 + m.age * 170);
      const d = T.distanceTo(m.p);
      const lead = _a.copy(T);
      if (tv) lead.addScaledVector(tv, Math.min(1.2, d / speed) * 0.8);
      const want = _b.copy(lead).sub(m.p).normalize();
      const cur = _c.copy(m.v).normalize();
      if (m.age > 0.18) {
        const ang = Math.acos(clamp(cur.dot(want), -1, 1));
        const turn = Math.min(1, (6 * dt) / Math.max(ang, 1e-4));
        cur.lerp(want, turn).normalize();
      }
      m.v.copy(cur).multiplyScalar(m.age > 0.18 ? speed : m.v.length());
      if (m.age <= 0.18) m.v.y -= 9 * dt;
      m.p.addScaledVector(m.v, dt);
      m.g.position.copy(m.p);
      m.g.lookAt(_a.copy(m.p).add(m.v));
      m.g.children[2].scale.set(1, 0.7 + Math.random() * 0.6, 1);
      if (m.age > 0.2 && (m.puff -= dt) <= 0) { m.puff = 0.03; s.effects.puff(_a.copy(m.p).addScaledVector(cur, -1.1), _b.set((Math.random() - 0.5), 0.6, (Math.random() - 0.5)), 0.2, 0xdedede, 0.9); }
      const gone = m.target.out || !m.target.model.group.visible;
      if (d < 3.2 && !gone) this.explode(m, true);
      else if (m.age > 6 || (gone && m.age > 1)) this.explode(m, false);
    }
    // explosions
    this.booms = this.booms.filter((b) => {
      b.age += dt;
      const k = b.age / 0.7;
      b.m.scale.setScalar((b.m.userData.size || 7) * Math.sqrt(Math.min(1, k * 2.5)));
      b.m.material.opacity = 1 - k;
      if (k >= 1) { s.renderer.scene.remove(b.m); b.m.material.dispose(); return false; }
      return true;
    });
    // quizzes, overheating engines, cars about to become wrecks
    for (const e of s.entries) {
      if (e.quiz) {
        if (e.quiz.ai) { if (s.clock >= e.quiz.at) { const ok = e.quiz.ok; e.quiz = null; this.quizDone(e, ok); } }
        else if (!e.quiz.done) e.quiz.update(dt);
      }
      if (e.burn && e.car && !e.out) {
        e.burn.t += dt;
        const k = Math.min(1, e.burn.t / BURN_TIME);
        e.car.spec = { ...e.burnSpec, enginePower: e.burnSpec.enginePower * (1 - 0.65 * k), engineForceMax: e.burnSpec.engineForceMax * (1 - 0.5 * k) };
        if (e.burn.t >= BURN_TIME) {
          this.boom(e.car.pos, 1.4);
          e.car.vel.add(_a.set((Math.random() - 0.5) * 6, 11, (Math.random() - 0.5) * 6));
          e.car.angVel.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 10);
          e.burn = null;
          e.fx = 2;
          e.wreckAt = s.clock + 1.8;
          if (e === s.player) s.message('KABOOM', 'warn', 2);
        }
      }
      // a wreck once it's come down (or has been tumbling far too long)
      if (e.wreckAt && s.clock >= e.wreckAt && e.car && !e.out && ((e.car.grounded && e.car.speed < 6) || s.clock >= e.wreckAt + 4)) this.wreck(e);
    }
    this.rebuild?.update(dt);
    this.duelGame?.update(dt);
    this.fires(dt);
    // wings: open, flap, fold (early if the flight was cut short)
    for (const [id, w] of this.wings) {
      w.t += dt;
      if (w.e.car && !w.e.flight && w.t < FLY_TIME - 0.4) w.t = FLY_TIME - 0.4;
      animateWings(w.g, w.t);
      if (w.t >= FLY_TIME) { w.e.model.group.remove(w.g); w.g.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); this.wings.delete(id); }
    }
    // boxes: the walls go up one after another, then the roof; then the shot
    for (let i = this.boxes.length - 1; i >= 0; i--) {
      const b = this.boxes[i];
      b.t += dt;
      const gp = b.e.model.group.position;
      b.g.position.set(gp.x, gp.y - 0.55, gp.z);
      const near = gp.distanceTo(s.renderer.camera.position) < 90;
      b.parts.forEach((w, k) => {
        const at = 0.05 + k * 0.15;
        if (b.t < at) return;
        if (!w.visible) { w.visible = true; if (near) this.app.audio.play('thunk'); }
        const u = Math.max(0.01, Math.min(1, (b.t - at) / 0.1));
        if (k < 4) w.scale.y = u; else w.scale.set(u, 1, u);
      });
      if (b.e.car && b.e.boxed) { b.e.car.vel.set(0, 0, 0); b.e.car.angVel.set(0, 0, 0); }
      if (b.t >= BOX_SHOT || b.e.out) { this.boxes.splice(i, 1); if (b.e.out) { b.e.boxed = null; s.renderer.scene.remove(b.g); } else this.snipe(b); }
    }
    for (let i = this.planks.length - 1; i >= 0; i--) {
      const p = this.planks[i];
      p.age += dt;
      p.v.y -= 20 * dt;
      p.m.position.addScaledVector(p.v, dt);
      p.m.rotation.x += p.w.x * dt; p.m.rotation.y += p.w.y * dt; p.m.rotation.z += p.w.z * dt;
      if (p.age > 1.4) p.m.scale.setScalar(Math.max(0.01, 1 - (p.age - 1.4) / 0.4));
      if (p.age > 1.8) { s.renderer.scene.remove(p.m); if (!p.keep) p.m.geometry.dispose(); this.planks.splice(i, 1); }
    }
    this.fx = this.fx.filter((f) => !f(dt));
    // cars sitting out come back when their time's up; missile victims go back
    for (const e of s.entries) {
      if (e.out) { e.model.group.visible = !!e.out.keep; if (s.time >= e.out.until) this.release(e); }
      if (e.sendBack && s.clock >= e.sendBack) { e.sendBack = 0; if (e.car && !e.out) { s.respawn(e, 'missed'); if (e === s.player) s.message('MISSILE HIT - BACK TO CHECKPOINT', 'warn', 2.4); } }
    }
    this.hud();
  }

  explode(m, onTarget) {
    const s = this.s;
    this.missiles.splice(this.missiles.indexOf(m), 1);
    s.renderer.scene.remove(m.g);
    m.g.traverse((o) => { o.geometry?.dispose(); if (o.material && o.material !== this.flameMat) o.material.dispose(); });
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), this.boomMat.clone());
    b.position.copy(m.p);
    s.renderer.scene.add(b);
    this.booms.push({ m: b, age: 0 });
    for (let k = 0; k < 18; k++) s.effects.spark(m.p, _a.set((Math.random() - 0.5) * 18, Math.random() * 12, (Math.random() - 0.5) * 18));
    for (let k = 0; k < 8; k++) s.effects.puff(_a.copy(m.p).add(_b.set((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3)), _b.set(0, 2, 0), 1.2 + Math.random(), 0x4a4a4a, 1.6);
    const cd = m.p.distanceTo(s.renderer.camera.position);
    this.app.audio.play(cd < 160 ? 'blast' : 'blastFar');
    if (cd < 80) s.camera.shake = Math.max(s.camera.shake, 1.3 * (1 - cd / 80));
    const e = m.target;
    if (!onTarget || !e.car || e.out) return;
    // thrown, then back to the last checkpoint
    e.car.vel.multiplyScalar(0.4).add(_a.set((Math.random() - 0.5) * 6, 13, (Math.random() - 0.5) * 6));
    e.car.angVel.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8);
    e.sendBack = s.clock + 1.2;
    s.emit('missileHit', { id: e.id, by: m.by });
  }

  // lock-on brackets for your missiles; a warning when one is after you
  hud() {
    const s = this.s, cam = s.renderer.camera;
    if (!this.ui.isConnected && this.app.ui.current === 'hud') this.app.ui.hudLayer.append(this.ui);
    const W = innerWidth, H = innerHeight;
    const me = s.player?.id;
    const mine = this.missiles.filter((m) => m.by === me);
    while (this.locks.length < mine.length) { const el = h('div.pk-lock'); this.ui.append(el); this.locks.push(el); }
    this.locks.forEach((el, i) => {
      const m = mine[i];
      if (!m) { el.style.display = 'none'; return; }
      _a.copy(m.target.model.group.position); _a.y += 0.8;
      _a.project(cam);
      if (_a.z > 1) { el.style.display = 'none'; return; }
      el.style.display = '';
      el.style.transform = `translate(${((_a.x * 0.5 + 0.5) * W).toFixed(0)}px, ${((-_a.y * 0.5 + 0.5) * H).toFixed(0)}px) translate(-50%, -50%)`;
    });
    const l = this.launchers.get(me);
    const left = l ? MISSILE_TIME - l.t : 0;
    const fw = this.wings.get(me), fly = fw && s.player?.flight ? FLY_TIME - fw.t : 0;
    this.armedEl.textContent = left > 0 ? `MISSILES ARMED  ${Math.ceil(left)}` : fly > 0 ? `FLYING  ${Math.ceil(fly)}` : '';
    this.armedEl.classList.toggle('on', left > 0 || fly > 0);
    this.warnEl.classList.toggle('on', this.missiles.some((m) => m.target === s.player));
  }

  dispose() {
    for (const e of this.s.entries) if (e.quiz && !e.quiz.ai && !e.quiz.done) e.quiz.dispose();
    this.rebuild?.dispose();
    this.rebuild = null;
    this.duelGame?.dispose();
    this.duelGame = null;
    for (const m of this.missiles) this.s.renderer.scene.remove(m.g);
    for (const b of this.booms) this.s.renderer.scene.remove(b.m);
    for (const l of this.launchers.values()) l.e.model.group.remove(l.g);
    for (const w of this.wings.values()) w.e.model.group.remove(w.g);
    for (const b of this.boxes) this.s.renderer.scene.remove(b.g);
    for (const p of this.planks) this.s.renderer.scene.remove(p.m);
    for (const f of this.fx) f(99);
    this.missiles = []; this.booms = []; this.launchers.clear(); this.wings.clear(); this.boxes = []; this.planks = []; this.fx = [];
    this.ui.remove();
  }
}
