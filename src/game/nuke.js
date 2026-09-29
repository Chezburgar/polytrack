// /nuke: an air-raid siren and a red alert, a bomb falling on the rival nearest
// whoever called it, then a flash, a fireball, a mushroom cloud and a shockwave
// that throws every other car off the track as it reaches them. The caller is
// shielded. Online, every client runs the same nuke from the host's message and
// blows up only the cars it drives itself (its player, and the host its bots).
import * as THREE from 'three';
import { h } from '../ui/dom.js';
import { smoothstep, mulberry32 } from '../util/math.js';
import { frameAt } from '../track/geometry.js';

export const NUKE_TIME = 3.2; // launch -> detonation (s)
const LENGTH = 13; // the whole show
const CAM_IN = NUKE_TIME - 1.4, CAM_OUT = NUKE_TIME + 2.4; // the wide shot
const SHOCK_SPEED = 320; // m/s: the shockwave's reach grows this fast
const SHOCK_MAX = 2600;
const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

// Where the bomb lands: on the road where the rival nearest the caller will be
// when it goes off (so the caller sees it ahead), or ahead of the caller if
// there's nobody else.
export function pickTarget(session, byId) {
  const by = session.entries.find((e) => e.id === byId);
  const from = by ? by.model.group.position : session.track.start.p;
  let best = null, bd = Infinity;
  for (const e of session.entries) {
    if (e.id === byId || e.kind === 'ghost' || e.race.finished) continue;
    const d = e.model.group.position.distanceToSquared(from);
    if (d < bd) { bd = d; best = e; }
  }
  const who = best || by;
  if (!who) return session.track.start.p.clone();
  const speed = who.car ? Math.max(0, who.car.forwardSpeed) : who.vel?.length() || 0;
  const s = (who.prog.s ?? 0) + speed * NUKE_TIME * 0.9 + (best ? 0 : 80);
  return frameAt(session.track, s).p.clone();
}

export class Nuke {
  constructor(session, { by, at }) {
    this.s = session;
    this.app = session.app;
    this.by = by;
    this.at = at.clone();
    this.t = 0;
    this.hit = new Set(); // cars the shockwave has reached
    this.rnd = mulberry32((Date.now() & 0xffff) ^ 0x51);
    const mine = session.player && session.player.id === by;
    this.mine = mine;
    this.scene = session.renderer.scene;
    this.group = new THREE.Group();
    this.group.name = 'nuke';
    this.scene.add(this.group);
    this.buildBomb();
    this.buildShield();
    // the alert on screen
    this.el = h('div.nuke-fx' + (mine ? '.mine' : ''),
      h('div.nk-vignette'),
      h('div.nk-banner', h('b', '☢ NUCLEAR LAUNCH DETECTED ☢'), h('span', mine ? 'NUKE AWAY - YOU ARE SHIELDED' : 'TAKE COVER')),
      this.countEl = h('div.nk-count', '3'),
      this.flashEl = h('div.nk-flash'),
      this.afterEl = h('div.nk-after'));
    this.app.ui.root.append(this.el);
    this.app.audio.siren?.(NUKE_TIME);
  }

  get done() { return this.t >= LENGTH; }

  // ---- models --------------------------------------------------------------------
  buildBomb() {
    const g = new THREE.Group();
    const olive = new THREE.MeshLambertMaterial({ color: 0x4a5a3a, flatShading: true });
    const band = new THREE.MeshLambertMaterial({ color: 0xf2c230, flatShading: true });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 4.4, 12), olive);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), olive);
    nose.position.y = -2.2; nose.rotation.x = Math.PI;
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.9, 1.4, 12), olive);
    tail.position.y = 2.9;
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.92, 0.35, 12), band);
    stripe.position.y = -1.2;
    g.add(body, nose, tail, stripe);
    for (let k = 0; k < 4; k++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.3, 1.5), olive);
      const a = (k * Math.PI) / 2;
      fin.position.set(Math.sin(a) * 0.9, 3.2, Math.cos(a) * 0.9);
      fin.rotation.y = a;
      g.add(fin);
    }
    g.scale.setScalar(1.8);
    g.visible = false;
    this.bomb = g;
    this.group.add(g);
  }

  buildShield() {
    const by = this.s.entries.find((e) => e.id === this.by);
    if (!by) return;
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x5ad8ff), transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending, wireframe: true });
    this.shield = new THREE.Mesh(new THREE.IcosahedronGeometry(3.1, 1), m);
    this.shield.position.y = 0.4;
    by.model.group.add(this.shield);
    this.shieldCar = by.model.group;
  }

  buildBlast() {
    const at = this.at;
    const glow = (c, k) => new THREE.Color(c).multiplyScalar(k);
    // fireball: bright enough to bloom, then cooling
    this.fireMat = new THREE.MeshLambertMaterial({ color: 0xffc070, emissive: 0xffa040, emissiveIntensity: 3, flatShading: true, transparent: true, opacity: 1, fog: false });
    this.fire = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), this.fireMat);
    this.fire.position.copy(at);
    // the condensation dome and the ground ring of the shockwave
    this.domeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), this.domeMat);
    this.dome.position.copy(at);
    this.ringMat = new THREE.MeshBasicMaterial({ color: glow(0xffe0b0, 1.6), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 96, 1), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.copy(at).y += 0.6;
    // the mushroom cloud: a cap of puffs round a torus, a column under it, dust
    // round the foot - one material whose inner glow fades as it cools
    this.cloudMat = new THREE.MeshLambertMaterial({ color: 0xc89a78, emissive: 0xff5a10, emissiveIntensity: 2.2, flatShading: true, transparent: true, opacity: 1, fog: false });
    const puff = new THREE.IcosahedronGeometry(1, 1);
    const rnd = this.rnd;
    this.cap = new THREE.Group();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, r = 22 + rnd() * 6;
      const m = new THREE.Mesh(puff, this.cloudMat);
      m.position.set(Math.cos(a) * r, (rnd() - 0.5) * 8, Math.sin(a) * r);
      m.scale.setScalar(13 + rnd() * 6);
      this.cap.add(m);
    }
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(puff, this.cloudMat);
      const a = rnd() * Math.PI * 2, r = rnd() * 14;
      m.position.set(Math.cos(a) * r, 10 + rnd() * 10, Math.sin(a) * r);
      m.scale.setScalar(16 + rnd() * 8);
      this.cap.add(m);
    }
    this.stem = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(puff, this.cloudMat);
      m.position.set((rnd() - 0.5) * 4, i / 8, (rnd() - 0.5) * 4);
      m.scale.set(7 + rnd() * 2, 0.16, 7 + rnd() * 2);
      this.stem.add(m);
    }
    this.skirt = new THREE.Group();
    // the base surge: dust, not fire
    this.dustMat = new THREE.MeshLambertMaterial({ color: 0xa89a88, flatShading: true, transparent: true, opacity: 0.9, fog: false });
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const m = new THREE.Mesh(puff, this.dustMat);
      m.position.set(Math.cos(a), 0, Math.sin(a));
      m.scale.set(9 + rnd() * 5, 5 + rnd() * 3, 9 + rnd() * 5);
      this.skirt.add(m);
    }
    for (const g of [this.cap, this.stem, this.skirt]) g.position.copy(at);
    this.group.add(this.fire, this.dome, this.ring, this.cap, this.stem, this.skirt);
    this.cap.visible = this.stem.visible = this.skirt.visible = false;
  }

  // ---- time ------------------------------------------------------------------------
  update(dt) {
    const prev = this.t;
    this.t += dt;
    const T = this.t, s = this.s;
    // the alert
    const left = NUKE_TIME - T;
    if (left > 0) this.countEl.textContent = String(Math.ceil(left));
    else this.countEl.textContent = '';
    // the bomb: in from high above, nose down, trailing smoke
    const fall0 = NUKE_TIME - 2.3;
    if (T >= fall0 && T < NUKE_TIME) {
      const u = (T - fall0) / (NUKE_TIME - fall0);
      const b = this.bomb;
      b.visible = true;
      b.position.set(this.at.x + (1 - u) * 60, this.at.y + 2 + (1 - u * u) * 420, this.at.z - (1 - u) * 40);
      b.lookAt(_v.set(this.at.x, this.at.y, this.at.z));
      b.rotateX(-Math.PI / 2);
      if (this.rnd() < 0.8) s.effects.puff(_w.copy(b.position).addScaledVector(UP, 4), _v.set((this.rnd() - 0.5) * 2, 2, (this.rnd() - 0.5) * 2), 2.2 + this.rnd(), 0xd8d8d8, 2.4);
    }
    if (prev < NUKE_TIME && T >= NUKE_TIME) this.detonate();
    if (T >= NUKE_TIME) this.blast(T - NUKE_TIME);
    this.cinema(T);
    // the caller's shield fades after the wave has passed
    if (this.shield) {
      this.shield.material.opacity = 0.5 * (1 - smoothstep(NUKE_TIME + 2.5, NUKE_TIME + 3.5, T)) * (0.8 + 0.2 * Math.sin(T * 12));
      this.shield.rotation.y += dt * 0.8;
      if (T > NUKE_TIME + 3.5) { this.shieldCar.remove(this.shield); this.shield.geometry.dispose(); this.shield.material.dispose(); this.shield = null; }
    }
  }

  detonate() {
    this.bomb.visible = false;
    this.buildBlast();
    const s = this.s, app = this.app;
    app.audio.nukeBoom?.();
    this.el.classList.add('boom');
    s.camera.shake = Math.max(s.camera.shake, 2.2);
    if (s.mode !== 'online') s.slowmo = { t: 0 }; // a moment of slow motion
    this.hemi0 = app.renderer.hemi.intensity;
    this.afterEl.textContent = this.mine ? 'DIRECT HIT' : 'NUKED';
  }

  // after the flash: the fireball, the cloud rising, the wave running outward
  blast(t) {
    const s = this.s, r = this.app.renderer;
    // the fireball swells, then cools and becomes the cloud's cap
    const fr = 42 * smoothstep(0, 0.6, t) + t * 2;
    this.fire.scale.setScalar(Math.max(0.1, fr));
    this.fire.position.y = this.at.y + fr * 0.5 + t * 6;
    const cool = smoothstep(0.3, 1.6, t);
    this.fireMat.emissiveIntensity = 3 * (1 - cool) + 0.6;
    this.fireMat.emissive.setRGB(1, 0.62 - 0.3 * cool, 0.25 - 0.2 * cool);
    this.fireMat.opacity = 1 - smoothstep(1.2, 2, t); // the cloud takes over
    this.fire.visible = this.fireMat.opacity > 0.01;
    // the dome and ring of the shockwave
    const R = Math.min(SHOCK_MAX, t * SHOCK_SPEED);
    this.dome.scale.setScalar(Math.min(R, 260));
    this.domeMat.opacity = 0.45 * (1 - smoothstep(0.2, 1.1, t));
    this.dome.visible = this.domeMat.opacity > 0.01;
    this.ring.scale.setScalar(Math.max(1, R));
    this.ringMat.opacity = 0.85 * (1 - smoothstep(0.4, 2.8, t));
    this.ring.visible = this.ringMat.opacity > 0.01;
    // the mushroom cloud rises and spreads, its glow fading
    if (t > 0.7) {
      this.cap.visible = this.stem.visible = this.skirt.visible = true;
      const u = t - 0.7;
      const height = 40 + 150 * (1 - Math.exp(-u / 3));
      const spread = 0.55 + 0.75 * (1 - Math.exp(-u / 2.6));
      this.cap.position.y = this.at.y + height;
      this.cap.scale.setScalar(spread);
      this.cap.rotation.y += 0.002;
      this.stem.position.y = this.at.y;
      this.stem.scale.set(0.7 + spread * 0.5, height * 0.92, 0.7 + spread * 0.5);
      const sk = 25 + 55 * (1 - Math.exp(-u / 1.5));
      this.skirt.children.forEach((m, i) => { const a = (i / 18) * Math.PI * 2; m.position.set(Math.cos(a) * sk, 2, Math.sin(a) * sk); });
      this.cloudMat.emissiveIntensity = 2.2 * Math.exp(-u / 1.8) + 0.05;
      this.cloudMat.opacity = 1 - smoothstep(LENGTH - NUKE_TIME - 3, LENGTH - NUKE_TIME, t);
      this.dustMat.opacity = 0.9 * (1 - smoothstep(3, 7, u));
      // a puff right at the lens would fill the screen: hide it until we're past
      const cam = r.camera.position;
      for (const g of [this.cap, this.stem, this.skirt]) {
        for (const m of g.children) {
          m.getWorldPosition(_w);
          const rad = Math.max(m.scale.x, m.scale.z) * g.scale.x;
          m.visible = _w.distanceTo(cam) > rad * 1.25 + 6;
        }
      }
    }
    // the sky lights up orange, then settles
    r.hemi.intensity = this.hemi0 * (1 + 3.5 * Math.exp(-t / 0.5));
    // the wave reaches the cars: everyone but the caller goes flying
    for (const e of s.entries) {
      if (!e.car || e.id === this.by || this.hit.has(e.id) || e.race.finished) continue;
      const d = _v.copy(e.car.pos).sub(this.at).setY(0).length();
      if (d > R) continue;
      this.hit.add(e.id);
      this.throwCar(e, d);
    }
  }

  // The wide shot: from well back on the viewer's side of ground zero, the bomb
  // coming down, the flash, the cars thrown clear, the cloud climbing. The local
  // car drives itself meanwhile.
  cinema(T) {
    const s = this.s, cam = this.app.renderer.camera;
    const on = T >= CAM_IN && T < CAM_OUT && s.camera.mode !== 'finish';
    if (on && !this.cam) {
      const f = s.focus?.model.group.position || this.at;
      const d = _v.copy(f).sub(this.at).setY(0);
      if (d.lengthSq() < 900) d.set(1, 0, 0.4);
      d.normalize();
      this.cam = { dir: d.clone(), mode: s.camera.mode, auto: s.autopilot };
      s.camera.setMode('script');
      s.autopilot = true; // nobody can drive blind
    }
    if (this.cam && on) {
      const u = (T - CAM_IN) / (CAM_OUT - CAM_IN);
      const dist = 230 - 40 * u;
      const p = _w.copy(this.at).addScaledVector(this.cam.dir, dist);
      const ground = s.loaded.terrain?.meshHeightAt?.(p.x, p.z) ?? this.at.y;
      p.y = Math.max(this.at.y, ground) + 32;
      cam.position.copy(p);
      cam.up.set(0, 1, 0);
      // follow the bomb down, then the cloud up
      const look = _v.copy(this.at);
      if (T < NUKE_TIME) look.lerp(this.bomb.position, 0.6 * (1 - smoothstep(NUKE_TIME - 0.6, NUKE_TIME, T))).y += 20;
      else look.y += 30 + 60 * smoothstep(0, 2.4, T - NUKE_TIME);
      cam.lookAt(look);
      if (cam.fov !== 55) { cam.fov = 55; cam.updateProjectionMatrix(); }
      this.app.renderer.followShadow(this.at);
    }
    if (this.cam && !on) this.endCinema();
  }

  endCinema() {
    const s = this.s, c = this.cam;
    this.cam = null;
    s.autopilot = c.auto;
    if (s.camera.mode === 'script') {
      s.camera.setMode(c.mode === 'script' ? this.app.settings.camera || 'chase' : c.mode);
      if (s.focus) s.camera.snap(s._camTarget(s.focus));
    }
  }

  throwCar(e, d) {
    const car = e.car, rnd = this.rnd;
    const away = _v.copy(car.pos).sub(this.at).setY(0);
    if (away.lengthSq() < 1) away.set(rnd() - 0.5, 0, rnd() - 0.5);
    away.normalize();
    const k = 0.75 + 0.25 * Math.exp(-d / 400); // still huge from far away
    car.vel.multiplyScalar(0.3).addScaledVector(away, 30 * k).addScaledVector(UP, 22 + 8 * k);
    car.angVel.set((rnd() - 0.5) * 9, (rnd() - 0.5) * 7, (rnd() - 0.5) * 9);
    e.ghostUntil = 0;
    if (e === this.s.player) this.s.message('YOU GOT NUKED', 'warn', 2.5);
    this.s.emit('nuked', { id: e.id });
  }

  dispose() {
    if (this.cam) this.endCinema();
    if (this.hemi0 != null) this.app.renderer.hemi.intensity = this.hemi0;
    if (this.shield) this.shieldCar.remove(this.shield);
    this.scene.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    this.el.classList.add('leave');
    const el = this.el;
    setTimeout(() => el.remove(), 600);
  }
}

