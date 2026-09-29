// /pitstop: a 10 second film of the victim's pit stop going wrong. The car
// comes in, the crew swarm it - then a wheel rolls off down the pit lane, the
// jack man slips in oil and the nose drops, and they bolt on a tiny spare
// before waving it out again, wobbling.
import * as THREE from 'three';
import { buildCar } from '../../car/model.js';
import { Cutscene, person, walk, box, tube, textPanel, glowMat, puffBall, ease, lin, mix, V } from './kit.js';

export const PITSTOP_LENGTH = 10;
// wheel order on the car model: front-left, front-right, rear-left, rear-right
const RR = 3;

export class PitstopScene extends Cutscene {
  constructor(app, victim, opts = {}) {
    super(app, { length: PITSTOP_LENGTH, ...opts });
    this.name = (victim.name || 'Racer').replace(/\s*\(AI\)$/, '');
    const paint = victim.custom?.paint || '#e8433a';
    const sc = this.scene;
    sc.background = new THREE.Color(0xb8cce0);
    sc.fog = new THREE.Fog(0xb8cce0, 60, 160);
    // ---- the pit lane and the garage --------------------------------------------------
    const lane = box(140, 0.2, 30, 0x55585f, 0, -0.1, 0);
    sc.add(lane);
    for (const z of [-4.6, 4.6]) sc.add(box(140, 0.02, 0.18, 0xf2f2f2, 0, 0.01, z));
    for (const [x, z, w, d] of [[0, -3.2, 9, 0.2], [0, 3.2, 9, 0.2], [-4.5, 0, 0.2, 6.4], [4.5, 0, 0.2, 6.4]]) sc.add(box(w, 0.03, d, 0xffd23c, x, 0.02, z));
    const team = new THREE.MeshLambertMaterial({ color: paint, flatShading: true });
    sc.add(box(30, 7, 0.4, 0xd8dbe0, 0, 3.5, -9.5), box(0.4, 7, 6, 0xc8ccd2, -15, 3.5, -6.5), box(0.4, 7, 6, 0xc8ccd2, 15, 3.5, -6.5), box(31, 0.4, 7, 0x8a8e96, 0, 7.1, -6.5));
    sc.add(box(30, 1.2, 0.3, team, 0, 5.8, -9.2));
    const banner = textPanel([`TEAM ${this.name.toUpperCase()}`], 12, 1.1, { bg: '#1a1d24', fg: '#ffffff' });
    banner.position.set(0, 5.8, -9.0);
    sc.add(banner);
    for (const [x, n] of [[-11, 5], [-9.4, 4], [10, 5], [11.6, 3]]) {
      for (let i = 0; i < n; i++) { const t = tube(0.7, 0.7, 0.55, 0x1a1a1a, 12); t.position.set(x, 0.3 + i * 0.56, -7.6); sc.add(t); }
    }
    sc.add(box(1.6, 1.1, 0.8, 0xc83a2a, -6, 0.55, -7.8), box(1.1, 2.6, 0.9, 0x3a3d44, 7, 1.3, -8));
    sc.add(box(140, 1, 0.5, 0xb8b4ac, 0, 0.5, 9)); // pit wall
    // ---- the car ---------------------------------------------------------------------
    const model = (this.model = buildCar(victim.custom, { shadows: false }));
    model.group.rotation.y = Math.PI / 2; // nose along +x
    sc.add(model.group);
    // the tiny spare: a yellow donut, half size
    this.spare = new THREE.Group();
    const donut = tube(0.24, 0.24, 0.16, 0x1a1a1a, 12); donut.rotation.x = Math.PI / 2;
    const hub = tube(0.14, 0.14, 0.18, 0xffd23c, 10); hub.rotation.x = Math.PI / 2;
    this.spare.add(donut, hub);
    this.spare.visible = false;
    sc.add(this.spare);
    this.loose = model.wheels[RR];
    // ---- the crew ----------------------------------------------------------------------
    const crew = { suit: new THREE.Color(paint).getHex(), trim: 0xf2f2f2 };
    const spots = [[1.35, -2.1], [1.35, 2.1], [-1.3, -2.1], [-1.3, 2.1], [3.8, 0], [6.2, 1.2]];
    this.crew = spots.map(([x, z], i) => {
      const p = person(crew);
      p.userData.home = V(-9 + i * 3, 0, -6);
      p.userData.spot = V(x, 0, z);
      p.position.copy(p.userData.home);
      sc.add(p);
      return p;
    });
    this.jackman = this.crew[4];
    this.chaser = this.crew[3];
    this.lolly = this.crew[5];
    const lollipop = new THREE.Group();
    lollipop.add(tube(0.04, 0.04, 2, 0x333333), textPanel(['GO?'], 0.9, 0.9, { bg: '#e8433a' }));
    lollipop.children[0].position.y = 1;
    lollipop.children[1].position.y = 2.2;
    lollipop.position.set(0, 0, 0.3);
    this.lolly.userData.shR.add(lollipop);
    lollipop.rotation.x = Math.PI;
    lollipop.position.set(0, -0.7, 0.2);
    this.oil = new THREE.Mesh(new THREE.CircleGeometry(1.1, 12), new THREE.MeshBasicMaterial({ color: 0x0a0a0a }));
    this.oil.rotation.x = -Math.PI / 2; this.oil.position.set(3.8, 0.03, 0.4); this.oil.visible = false;
    sc.add(this.oil);
    this.sparkMat = glowMat(0xffc15a, 3);
    this.sparks = [];
    this.puffs = [];
    this.cues = new Set();
  }

  cue(name, fn) { if (!this.cues.has(name)) { this.cues.add(name); fn(); } }

  sparkAt(p, n = 6) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.25), this.sparkMat);
      m.position.copy(p);
      m.userData.v = V((Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.5) * 6);
      m.userData.life = 0.4 + Math.random() * 0.3;
      this.scene.add(m);
      this.sparks.push(m);
    }
  }

  play(t, dt) {
    const a = this.app.audio, model = this.model, g = model.group;
    // ---- the car: in, up on the jack, down with a bump, out wobbling --------------------
    let x = -38 + 38 * ease(t, 0, 2), y = 0.62, pitch = 0, yaw = Math.PI / 2;
    const lift = ease(t, 2.4, 2.9) - ease(t, 5.9, 6.05) * 0.8;
    y += lift * 0.35;
    if (t > 5.9 && t < 8.3) pitch = -0.1 * ease(t, 5.9, 6.05); // the nose on the ground
    if (t > 8.3) { const k = ease(t, 8.3, 10); x = 40 * k * k; yaw += Math.sin(t * 14) * 0.08 * (1 - k * 0.5); pitch = 0; }
    g.position.set(x, y, 0);
    g.rotation.set(0, yaw, pitch, 'YXZ');
    const roll = t < 2 ? (1 - ease(t, 0, 2)) * 30 : t > 8.3 ? (t - 8.3) * 25 : 0;
    for (const w of model.wheels) w.spin.rotation.x += roll * dt;
    this.cue('in', () => { a.play('rev'); this.caption('BOX, BOX!', `${this.name} is coming in for a pit stop`); });
    // ---- the crew run out, work, and go wrong -------------------------------------------
    this.crew.forEach((p, i) => {
      const u = p.userData;
      const go = ease(t, 1.7 + i * 0.05, 2.5 + i * 0.05);
      if (p === this.chaser && t > 4.2) return; // he's off after the wheel
      if (p === this.jackman && t > 5.6) return; // he's on the floor
      p.position.lerpVectors(u.home, u.spot, go);
      p.lookAt(p.position.x - (u.spot.x > 5 ? 1 : 0), 0, u.spot.z > 1 ? p.position.z - 1 : u.spot.z < -1 ? p.position.z + 1 : p.position.z);
      if (u.spot.x > 3 && u.spot.z === 0) p.lookAt(p.position.x - 1, 0, p.position.z);
      walk(p, t * 12, go > 0 && go < 1 ? 0.8 : 0);
      if (t > 2.9 && t < 4.1 && i < 4) u.shR.rotation.x = -1.3 + Math.sin(t * 40) * 0.08; // wheel guns on
    });
    if (t > 2.9 && t < 4.1) {
      this.cue('guns', () => { a.play('wrench'); setTimeout(() => a.play('wrench'), 250); this.caption('', ''); });
      if (Math.random() < 0.5) for (const [wx, wz] of [[1.35, -1.05], [1.35, 1.05], [-1.3, -1.05], [-1.3, 1.05]]) this.sparkAt(V(x + wx, y - 0.3, wz), 1);
    }
    // the rear-right wheel comes off and rolls away; its man chases it
    if (t > 4.1) {
      this.cue('loose', () => {
        const w = this.loose;
        g.remove(w.pivot);
        this.scene.add(w.pivot);
        w.pivot.rotation.set(0, Math.PI / 2, 0);
        a.play('boing');
        this.caption('…uh oh', 'the rear right wheel has other plans');
      });
      const k = t - 4.1, w = this.loose.pivot;
      const wx = -1.3 + k * 3.2 + Math.max(0, k - 0.6) * 4, wz = 1.3 + Math.min(k, 0.6) * 5;
      w.position.set(wx, 0.36 + Math.abs(Math.sin(k * 7)) * 0.4 * Math.exp(-k), wz);
      w.rotation.set(0, k > 0.6 ? 0 : Math.PI / 2, 0);
      this.loose.spin.rotation.x -= dt * 14;
      const ch = this.chaser;
      ch.position.set(wx - 2.4 + Math.min(k, 1) * 0.6, 0, wz - 0.6);
      ch.lookAt(wx + 5, 0, wz - 0.6);
      walk(ch, t * 16, 1);
    }
    // the jack man slips on oil and the nose drops
    if (t > 5.3) this.oil.visible = true;
    if (t > 5.6) {
      const jm = this.jackman, k = ease(t, 5.6, 6.0);
      this.cue('slip', () => { a.play('slide'); setTimeout(() => a.play('clunk'), 380); this.caption('WHOOPS', 'someone left oil in the box'); });
      jm.position.set(3.8 + k * 0.8, 0.2 * k, 0.3);
      jm.rotation.set(0, -Math.PI / 2, 0);
      jm.rotateX(-k * 1.45);
      const u = jm.userData;
      u.hipL.rotation.x = -k * 1.2 + Math.sin(t * 20) * 0.3 * k; u.hipR.rotation.x = -k * 0.8 - Math.sin(t * 20) * 0.3 * k;
      u.shL.rotation.x = -k * 2.4; u.shR.rotation.x = -k * 2.1;
    }
    // the tiny spare goes on, hammered home
    if (t > 6.8) {
      this.spare.visible = t < 8.3;
      const k = ease(t, 6.8, 7.3);
      this.spare.position.set(x - 1.3, 0.26, mix(3.2, 1.0, k));
      const m = this.crew[1];
      m.position.set(x - 0.1, 0, mix(3.2, 1.9, k)); // beside the wheel, not in front of it
      m.lookAt(x - 1.3, 0, 0.9);
      m.userData.shR.rotation.x = t > 7.3 ? -1.8 + Math.abs(Math.sin(t * 9)) * 1.3 : -0.6;
      if (t > 7.3) for (const [c, at] of [['h1', 7.45], ['h2', 7.8], ['h3', 8.1]]) if (t > at) this.cue(c, () => { a.play('clank'); this.sparkAt(V(x - 1.3, 0.3, 1.0), 8); });
      this.cue('spare', () => this.caption('SPARE FITTED', 'it came off a shopping trolley'));
    }
    if (t > 8.3) {
      // the spare rides out on the car
      this.spare.visible = true;
      this.spare.position.set(x - 1.3, 0.26, 0.95);
      this.spare.rotation.z -= dt * 20;
      this.cue('out', () => { a.play('rev'); this.caption('GOOD LUCK OUT THERE', 'handling damaged for the rest of the race'); });
      if (Math.random() < dt * 9) this.puffs.push(puffBall(this.scene, V(x - 1.3, 0.3, 1.1), { glow: false, color: 0xb8b8b8, size: 0.5, life: 0.8, rise: 1.2 }));
      this.lolly.userData.shR.rotation.x = -2.6;
    } else this.lolly.userData.shR.rotation.x = t > 7.5 ? -1.8 : 0;
    // ---- particles --------------------------------------------------------------------
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const m = this.sparks[i], u = m.userData;
      u.life -= dt; u.v.y -= 9.8 * dt; m.position.addScaledVector(u.v, dt); m.lookAt(m.position.clone().add(u.v));
      if (u.life <= 0) { this.scene.remove(m); m.geometry.dispose(); this.sparks.splice(i, 1); }
    }
    this.puffs = this.puffs.filter((f) => !f(dt));
    // ---- camera --------------------------------------------------------------------------
    if (t < 2) this.look(V(x * 0.3 - 4, 3.2, 15), V(x * 0.6, 0.8, 0), 45);
    else if (t < 4.1) this.look(V(1.5, 2.8, 9.5), V(0, 0.8, 0), 45);
    else if (t < 5.6) { const w = this.loose.pivot.position; this.look(V(w.x - 3, 1.6, w.z + 6), V(w.x + 1, 0.5, w.z), 50); }
    else if (t < 6.8) this.look(V(6.8, 2, 6), V(3.8, 0.6, 0), 45);
    else if (t < 8.3) this.look(V(-3.2, 1.8, 6.5), V(-1.3, 0.5, 1), 45);
    else this.look(V(x - 7, 2.4, 9), V(x + 2, 0.6, 0), 48); // after it, wobbling off
  }
}

// the wobbly car's spare, as the other racers see it: a small yellow wheel
export function fitSpare(model) {
  const w = model.wheels[RR];
  if (!w || w.spin.userData.spare) return;
  w.spin.userData.spare = true;
  w.spin.scale.multiplyScalar(0.62);
  w.spin.material = new THREE.MeshLambertMaterial({ color: 0xffd23c, flatShading: true });
  model.materials.push(w.spin.material);
  w.spin.position.y = -0.13; // sit the smaller wheel on the ground
}
