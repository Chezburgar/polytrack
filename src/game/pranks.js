// Race pranks from the chat line, and what they do to the cars:
//  /missile         a roof launcher for 10 s that locks onto every car it can see
//                   and fires homing missiles; a hit sends that car back to its
//                   last checkpoint
//  /pitstop <name>  that car sits out 10 s in a botched pit stop and drives the
//                   rest of the race on a tiny spare (pulls, wobbles, less grip)
//  /yeet <name>     that car sits out 30 s (swatted to Mars by a cat)
// Every client runs the same pranks from the host's messages. Whoever drives a
// car decides what happens to it: the victim's own client, or the host for its
// AI. The films themselves are src/game/scenes/.
import * as THREE from 'three';
import { h } from '../ui/dom.js';
import { clamp, mulberry32, smoothstep } from '../util/math.js';
import { fitSpare } from './scenes/pitstop.js';
import { Quiz, Rebuild, makeQuestion, QUIZ_TIME } from './wreck.js';

export const MISSILE_TIME = 10;
export const PITSTOP_TIME = 10;
export const YEET_TIME = 30;
export const AD_TIME = 30;
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
      e.car.reset(r.pos, r.quat, 0);
      e.prevPos.copy(r.pos); e.prevQuat.copy(r.quat);
      e.prog.reset(r.index ?? e.prog.index);
      e.prog.update(e.car.pos);
      e.limits.reset();
      e.ghostUntil = s.clock + 2;
      if (e === s.focus) s.camera.snap(s._camTarget(e));
    }
    if (kind === 'pitstop') this.damage(e);
    if (kind === 'wreck') { e.fx = 0; if (e.car && e.burnSpec) { e.car.spec = e.burnSpec; e.burnSpec = null; } }
    if (e === s.player && this.app.cutscene && !this.app.cutscene.pauses) this.app.endFilm(); // your car's back: so are you
    if (e === s.player) s.message({ yeet: 'BACK FROM MARS', wreck: 'REBUILT - GO GO GO', advertisement: 'THANKS FOR WATCHING' }[kind] || 'OUT OF THE PITS - HANDLING DAMAGED', 'warn', 2.5);
  }

  // ---- /crash ---------------------------------------------------------------------------
  // A big crash, seen by everyone; the car's own driver throws it, and it ends up
  // a burning wreck to be rebuilt.
  crash(targetId) {
    const s = this.s, e = s.entries.find((x) => x.id === targetId);
    if (!e || e.out) return;
    this.boom(e.model.group.position, 1.6);
    e.boomedAt = s.clock; // (the wreck's fire, when it syncs, doesn't go boom again)
    if (!e.car) return;
    const car = e.car;
    car.vel.multiplyScalar(0.5).add(_a.set((Math.random() - 0.5) * 10, 16, (Math.random() - 0.5) * 10)).addScaledVector(car.fwd, 6);
    car.angVel.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 14);
    e.ghostUntil = 0;
    e.fx = 2;
    e.wreckAt = s.clock + 2.4; // let it tumble, then it's a wreck
    if (e === s.player) s.message('YOU CRASHED', 'warn', 2.4);
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

  // the botched pit stop, for the rest of the race: a tiny spare that pulls to
  // one side and wobbles, and less grip and power
  damage(e) {
    fitSpare(e.model);
    if (!e.car || e.handicap) return;
    const sp = e.car.spec;
    e.car.spec = { ...sp, mu: sp.mu * 0.84, enginePower: sp.enginePower * 0.9, engineForceMax: sp.engineForceMax * 0.92 };
    e.handicap = { pull: (this.rnd() < 0.5 ? -1 : 1) * 0.07, wobble: 0.1, t: 0 };
  }

  // steering fed through the damage (after the driver or AI has set it)
  steer(e, dt) {
    const hc = e.handicap, car = e.car;
    hc.t += dt;
    const k = clamp(car.speed / 18, 0, 1);
    car.input.steer = clamp(car.input.steer + (hc.pull + Math.sin(hc.t * 9.5) * hc.wobble) * k, -1, 1);
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
    this.fires(dt);
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
    this.armedEl.textContent = left > 0 ? `MISSILES ARMED  ${Math.ceil(left)}` : '';
    this.armedEl.classList.toggle('on', left > 0);
    this.warnEl.classList.toggle('on', this.missiles.some((m) => m.target === s.player));
  }

  dispose() {
    for (const e of this.s.entries) if (e.quiz && !e.quiz.ai && !e.quiz.done) e.quiz.dispose();
    this.rebuild?.dispose();
    this.rebuild = null;
    for (const m of this.missiles) this.s.renderer.scene.remove(m.g);
    for (const b of this.booms) this.s.renderer.scene.remove(b.m);
    for (const l of this.launchers.values()) l.e.model.group.remove(l.g);
    this.missiles = []; this.booms = []; this.launchers.clear();
    this.ui.remove();
  }
}
