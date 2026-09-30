// /pitstop pro: 6 seconds of a pit stop done properly. A crew of twelve in black
// and gold is already in position; the car stops on its marks, up on the jacks,
// the old wheels roll away and gold ones go on, the engine gets a tune - all on a
// stopwatch that stops under two seconds - and it launches.
import * as THREE from 'three';
import { h } from '../../ui/dom.js';
import { buildCar } from '../../car/model.js';
import { tyreLook } from '../tyres.js';
import { pitLane } from './pitstop.js';
import { Cutscene, person, walk, box, tube, textPanel, glowMat, puffBall, ease, mix, V } from './kit.js';

export const PROPIT_LENGTH = 6;
const IN = 1.3, JACK = 1.4, OFF = 1.55, SWAP = 1.85, ON = 2.15, DOWN = 2.95, GO = 3.15;
// the wheels in the scene (the car's nose along +x): front-left, front-right, rear-left, rear-right
const WHEELS = [[1.34, -0.84], [1.34, 0.84], [-1.3, -0.84], [-1.3, 0.84]];

export class ProPitScene extends Cutscene {
  constructor(app, victim, opts = {}) {
    super(app, { length: PROPIT_LENGTH, ...opts });
    this.name = (victim.name || 'Racer').replace(/\s*\(AI\)$/, '');
    const sc = this.scene;
    pitLane(sc, '#1a1a1f', `TEAM ${this.name.toUpperCase()} · PRO CREW`, { bg: '#1a1a1f', fg: '#ffc83a' });
    // ---- the car, on whatever it came in on ------------------------------------------
    const model = (this.model = buildCar(victim.custom, { shadows: false }));
    if (victim.tyres) tyreLook(model, victim.tyres);
    model.group.rotation.y = Math.PI / 2;
    sc.add(model.group);
    // ---- the crew: a gunner and a carrier at each wheel, two jacks, a tuner, the lollipop
    const kit = { suit: 0x34343e, trim: 0xffc83a, helmet: 0xffc83a };
    const at = (x, z, face) => { const p = person(kit); p.position.set(x, 0, z); p.lookAt(face.x, 0, face.z); sc.add(p); return p; };
    this.gunners = WHEELS.map(([x, z]) => at(x, Math.sign(z) * 2.5, V(x, 0, 0)));
    this.carriers = WHEELS.map(([x, z]) => at(x + (x > 0 ? 1 : -1), Math.sign(z) * 3.4, V(x, 0, 0)));
    this.frontJack = at(4.4, 0, V(0, 0, 0));
    this.rearJack = at(-3, -3.2, V(-3, 0, 0));
    this.tuner = at(2.6, -2.4, V(1.6, 0, 0));
    this.lolly = at(5.6, 1.8, V(0, 0, 0));
    // the tuner's laptop, the lollipop
    const laptop = box(0.5, 0.04, 0.36, 0x2a2d34); laptop.position.set(0, 1.05, 0.35);
    const screen = box(0.5, 0.34, 0.03, glowMat(0x5affb0, 1.6)); screen.position.set(0, 1.23, 0.18); screen.rotation.x = -0.3;
    this.tuner.add(laptop, screen);
    this.sign = new THREE.Group();
    const stick = tube(0.04, 0.04, 2, 0x333333); stick.position.y = 1;
    this.stopSign = textPanel(['STOP'], 0.9, 0.9, { bg: '#e8433a' }); this.stopSign.position.y = 2.2;
    this.goSign = textPanel(['GO!'], 0.9, 0.9, { bg: '#2cc84a' }); this.goSign.position.y = 2.2; this.goSign.visible = false;
    this.sign.add(stick, this.stopSign, this.goSign);
    this.sign.position.set(-0.6, 0, 0.6);
    this.lolly.add(this.sign);
    this.old = []; // the old wheels, rolling off
    this.sparkMat = glowMat(0xffd070, 3);
    this.goldMat = glowMat(0xffc83a, 2.6);
    this.sparks = [];
    this.puffs = [];
    this.cues = new Set();
    this.timerEl = h('div.pit-timer', '0.00');
    this.el.append(this.timerEl);
  }

  cue(name, fn) { if (!this.cues.has(name)) { this.cues.add(name); fn(); } }

  sparkAt(p, n = 6, mat = this.sparkMat) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.25), mat);
      m.position.copy(p);
      m.userData.v = V((Math.random() - 0.5) * 5, Math.random() * 5, (Math.random() - 0.5) * 5);
      m.userData.life = 0.35 + Math.random() * 0.3;
      this.scene.add(m);
      this.sparks.push(m);
    }
  }

  play(t, dt) {
    const a = this.app.audio, model = this.model, g = model.group;
    // ---- the car: in hard on the brakes, up, down, and gone ---------------------------
    let x = -34 + 34 * ease(t, 0, IN), y = 0.62 + 0.14 * (ease(t, JACK, JACK + 0.08) - ease(t, DOWN, DOWN + 0.06));
    if (t > DOWN && t < DOWN + 0.3) y -= Math.sin(((t - DOWN) / 0.3) * Math.PI) * 0.05; // settles on the springs
    if (t > GO) x = 0.5 * 14 * (t - GO) ** 2;
    g.position.set(x, y, 0);
    g.rotation.set(0, Math.PI / 2, t > GO && t < GO + 0.6 ? -0.03 : 0, 'YXZ'); // squats as it launches
    const roll = t < IN ? (1 - ease(t, 0, IN)) * 40 : t > GO ? 14 * (t - GO) / 0.36 + 20 : 0;
    for (const w of model.wheels) w.spin.rotation.x += roll * dt;
    this.cue('in', () => { a.play('rev'); this.caption('BOX, BOX', 'the pro crew is ready'); });
    // ---- the stopwatch: from the moment it stops ------------------------------------------
    const clock = t < IN ? 0 : Math.min(t, GO) - IN;
    this.timerEl.textContent = (clock * 0.98).toFixed(2);
    this.timerEl.classList.toggle('on', t > IN - 0.2);
    this.timerEl.classList.toggle('done', t >= GO);
    // ---- the crew ------------------------------------------------------------------------
    this.frontJack.position.x = mix(4.4, 3.5, ease(t, IN - 0.1, JACK));
    this.frontJack.userData.shL.rotation.x = this.frontJack.userData.shR.rotation.x = t > JACK && t < DOWN ? -1.2 : -0.3;
    const rj = this.rearJack, rjIn = ease(t, IN, JACK) - ease(t, DOWN, DOWN + 0.2);
    rj.position.set(mix(-3, -3.3, rjIn), 0, mix(-3.2, 0, rjIn));
    rj.lookAt(rjIn > 0.5 ? 0 : -3.3, 0, 0);
    walk(rj, t * 14, rjIn > 0.05 && rjIn < 0.95 ? 0.8 : 0);
    if (t > DOWN + 0.05) this.frontJack.position.z = mix(0, -2.6, ease(t, DOWN, GO)); // out of the way
    this.gunners.forEach((p, i) => {
      const [wx, wz] = WHEELS[i], s = Math.sign(wz);
      const lean = ease(t, IN, JACK) - ease(t, DOWN - 0.3, DOWN);
      p.position.set(wx, 0, s * mix(2.5, 1.75, lean));
      const firing = (t > JACK && t < OFF) || (t > ON && t < ON + 0.35);
      p.userData.shR.rotation.x = p.userData.shL.rotation.x = lean > 0.5 ? -1.3 + (firing ? Math.sin(t * 50) * 0.08 : 0) : t > DOWN ? -2.9 : -0.4; // done: arm up
      if (firing && Math.random() < 0.6) this.sparkAt(V(wx, 0.36, s * 1.2), 1);
    });
    if (t > JACK) this.cue('off', () => { a.play('wrench'); this.caption('', ''); });
    if (t > ON) this.cue('on', () => a.play('wrench'));
    // the wheels: out, the old ones roll away, the gold ones in
    model.wheels.forEach((w, i) => {
      const lx = w.pivot.userData.x ?? (w.pivot.userData.x = w.pivot.position.x);
      const out = ease(t, OFF, OFF + 0.2) - ease(t, SWAP + 0.05, ON);
      w.pivot.position.x = lx * (1 + out * 1.3);
      const c = this.carriers[i], [wx, wz] = WHEELS[i], s = Math.sign(wz);
      c.position.set(wx + (wx > 0 ? 1.1 : -1.1) * (1 - out * 0.5), 0, s * mix(3.4, 2.7, out));
      c.userData.shL.rotation.x = c.userData.shR.rotation.x = out > 0.2 ? -1.1 : -0.3;
    });
    if (t > SWAP) this.cue('swap', () => {
      // the old ones go rolling off; the gold ones go on
      model.wheels.forEach((w, i) => {
        const old = new THREE.Mesh(w.spin.geometry, w.spin.material);
        w.spin.getWorldPosition(old.position);
        old.quaternion.copy(w.spin.getWorldQuaternion(new THREE.Quaternion()));
        old.scale.copy(w.spin.scale);
        old.userData = { dir: Math.sign(WHEELS[i][1]), t: 0 };
        this.scene.add(old);
        this.old.push(old);
      });
      tyreLook(model, 'pro');
      a.play('ding');
      this.caption('NEW TYRES', 'gold compound · engine tune · aero trim');
    });
    for (const o of this.old) {
      o.userData.t += dt;
      o.position.z += o.userData.dir * dt * 3.2;
      o.position.x -= dt * 1.2;
      o.rotateX(-dt * 9);
      if (o.userData.t > 1.2) o.visible = false;
    }
    // the tuner's magic
    this.tuner.userData.shR.rotation.x = this.tuner.userData.shL.rotation.x = t > JACK && t < DOWN ? -0.9 + Math.sin(t * 30) * 0.1 : -0.5;
    if (t > JACK && t < DOWN && Math.random() < dt * 20) this.sparkAt(V(x + 1.8 + (Math.random() - 0.5), 1.2, (Math.random() - 0.5) * 1.2), 2, this.goldMat);
    // the lollipop: STOP, then GO
    this.stopSign.visible = t < GO;
    this.goSign.visible = t >= GO;
    this.lolly.userData.shR.rotation.x = -0.4;
    // ---- away --------------------------------------------------------------------------------
    if (t > GO) {
      this.cue('go', () => { a.play('boost'); a.play('rev'); this.caption(`${((GO - IN) * 0.98).toFixed(2)} SECONDS`, 'grip +30% · power +40% · top speed up', 'huge'); });
      if (t > GO + 1.3) this.caption('PIT STOP PRO', 'grip +30% · power +40% · top speed up');
      if (t < GO + 1 && Math.random() < dt * 16) this.puffs.push(puffBall(this.scene, V(x - 1.5, 0.3, (Math.random() < 0.5 ? -1 : 1) * 0.84), { glow: false, color: 0xd8d8d8, size: 0.45, life: 0.6, rise: 0.8 }));
      if (Math.random() < dt * 20) this.puffs.push(puffBall(this.scene, V(x - 2.4, 0.5, 0), { color: 0xffa040, size: 0.6, life: 0.25, rise: 0 }));
    }
    // ---- particles --------------------------------------------------------------------
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const m = this.sparks[i], u = m.userData;
      u.life -= dt; u.v.y -= 9.8 * dt; m.position.addScaledVector(u.v, dt); m.lookAt(m.position.clone().add(u.v));
      if (u.life <= 0) { this.scene.remove(m); m.geometry.dispose(); this.sparks.splice(i, 1); }
    }
    this.puffs = this.puffs.filter((f) => !f(dt));
    // ---- camera --------------------------------------------------------------------------
    if (t < IN) this.look(V(x * 0.3 + 3, 3, 13), V(x * 0.7, 0.8, 0), 45);
    else if (t < ON + 0.1) this.look(V(3.5, 9, 7.5), V(0.3, 0.3, 0), 45); // from above: the swarm, the swap
    else if (t < DOWN) this.look(V(5.8, 2.6, 4.4), V(1.2, 0.4, 0.84), 40); // the front-right wheel
    else if (t < GO) this.look(V(7, 2.6, 6.5), V(0.5, 0.7, 0), 44);
    else this.look(V(Math.min(x, 30) - 3, 1.8, 8), V(x + 2, 0.7, 0), 50); // side on, as it goes
  }
}
