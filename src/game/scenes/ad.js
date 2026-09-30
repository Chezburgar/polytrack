// /advertisement: 30 seconds of a very loud, very proud ad for a made-up burger
// chain, with a jingle, an "Ad 0:29" counter and a Skip Ad button that doesn't.
import * as THREE from 'three';
import { h } from '../../ui/dom.js';
import { Cutscene, box, ball, tube, textPanel, glowMat, puffBall, ease, V } from './kit.js';

export const AD_LENGTH = 30;

export class AdScene extends Cutscene {
  constructor(app, victim, opts = {}) {
    super(app, { length: AD_LENGTH, ...opts });
    this.real = !!opts.skippable; // the caller watching an AI's ad can really skip it
    const sc = this.scene;
    sc.background = new THREE.Color(0xffd23c);
    this.hemi.intensity = 1.5;
    // a turntable on a sunburst
    const burst = new THREE.Group();
    for (let i = 0; i < 16; i++) {
      const ray = new THREE.Mesh(new THREE.PlaneGeometry(4, 60), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffc21a : 0xffe06a, side: THREE.DoubleSide }));
      ray.position.y = 30; const g = new THREE.Group(); g.add(ray); g.rotation.z = (i / 16) * Math.PI * 2; burst.add(g);
    }
    burst.position.set(0, 4, -20);
    this.burst = burst;
    const plate = tube(6, 6.4, 0.6, 0xe8433a, 32); plate.position.y = -0.3;
    this.table = new THREE.Group(); this.table.add(plate);
    sc.add(burst, this.table);
    // the Poly Stack, layer by layer (y is where each lands)
    const layer = (m, y) => { m.userData.y = y; m.visible = false; this.table.add(m); return m; };
    const bun = 0xd9913a, patty = 0x5a3220, cheese = 0xffc21a, lettuce = 0x6ac83a, tomato = 0xe0402a;
    const bunB = tube(3.2, 3.4, 1.1, bun, 24); const top = ball(3.4, bun, 0, 0, 0, 2); top.scale.set(1, 0.62, 1);
    const flat = (color, r = 3.5, hgt = 0.7) => tube(r, r, hgt, color, 24);
    const cheeseM = box(6.4, 0.2, 6.4, cheese); cheeseM.rotation.y = 0.4;
    const cheese2 = box(6.4, 0.2, 6.4, cheese); cheese2.rotation.y = 1.1;
    const lettuceM = tube(3.9, 3.7, 0.35, lettuce, 12);
    this.layers = [
      layer(bunB, 0.55), layer(flat(patty), 1.45), layer(cheeseM, 1.9), layer(lettuceM, 2.15),
      layer(flat(tomato, 3.1, 0.35), 2.5), layer(flat(patty), 3.1), layer(cheese2, 3.55), layer(top, 4.1),
    ];
    for (let i = 0; i < 14; i++) { const seed = box(0.35, 0.12, 0.2, 0xfff4e0); const a = (i / 14) * Math.PI * 2 + i; seed.position.set(Math.cos(a) * (1 + (i % 3)), 1.9 - (i % 3) * 0.35, Math.sin(a) * (1 + (i % 3))); seed.rotation.y = a; top.add(seed); }
    // the burger car: the stack on wheels
    this.car = new THREE.Group();
    const cb = tube(2.2, 2.3, 0.8, bun, 20); cb.position.y = 1.1;
    const cp = tube(2.4, 2.4, 0.5, patty, 20); cp.position.y = 1.7;
    const cl = tube(2.6, 2.5, 0.25, lettuce, 12); cl.position.y = 2.05;
    const ct = ball(2.3, bun, 0, 2.3, 0, 1); ct.scale.set(1, 0.6, 1);
    this.car.add(cb, cp, cl, ct);
    this.wheels = [];
    for (const [x, z] of [[1.6, 1.4], [-1.6, 1.4], [1.6, -1.4], [-1.6, -1.4]]) { const w = tube(0.55, 0.55, 0.4, 0x1a1a1a, 12); w.rotation.z = Math.PI / 2; w.position.set(x, 0.55, z); this.car.add(w); this.wheels.push(w); }
    this.car.visible = false;
    sc.add(this.car);
    this.ground = new THREE.Group();
    this.ground.add(box(200, 0.2, 200, 0x6fae45, 0, -0.1, 0));
    const ring = new THREE.Mesh(new THREE.RingGeometry(7, 11, 48), new THREE.MeshLambertMaterial({ color: 0x4b4f59 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02;
    this.ground.add(ring);
    const sign = textPanel(['DRIVE-IN-TO-IT'], 8, 1.6, { bg: '#e8433a' }); sign.position.set(0, 3.2, -14);
    this.ground.add(sign, box(0.3, 3.2, 0.3, 0x444444, -3.5, 1.6, -14), box(0.3, 3.2, 0.3, 0x444444, 3.5, 1.6, -14));
    this.ground.visible = false;
    sc.add(this.ground);
    // price card
    this.price = textPanel(['ONLY $4.99*', '*plus tax, tip and your dignity'], 16, 6, { bg: '#e8433a', fg: '#ffffff', sizes: [1.05, 0.34] });
    this.price.position.set(0, 7, 0); this.price.visible = false;
    sc.add(this.price);
    this.sparkMat = glowMat(0xffffff, 2);
    this.sparkles = [];
    this.puffs = [];
    this.cues = new Set();
    // the ad furniture: a counter and the skip button
    this.adEl = h('div.ad-ui',
      this.countEl = h('div.ad-count', 'Ad · 0:30'),
      this.skipBtn = h('button.ad-skip', { type: 'button' }, 'Skip in 5'),
      h('div.ad-brand', 'PolyBurger®'));
    this.el.append(this.adEl);
    this.el.querySelector('.cut-skip').style.display = this.real ? '' : 'none';
    this.skipAt = 5;
    this.skipBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (this.t < this.skipAt) return;
      // it's an ad. of course you can't skip it
      this.skipAt = this.t + 5;
      this.skipBtn.textContent = 'Nice try';
      this.skipBtn.classList.remove('ready');
      app.audio.play('buzz');
    });
    this.nextNote = 0;
  }

  cue(n, fn) { if (!this.cues.has(n)) { this.cues.add(n); fn(); } }

  // the jingle: "Po-ly bur-ger, eat fast, drive fast-er" on a loop
  jingle(t) {
    const tune = [[72, 0.25], [76, 0.25], [79, 0.5], [76, 0.25], [79, 0.25], [84, 0.5], [83, 0.25], [79, 0.25], [81, 0.25], [79, 0.25], [76, 1]];
    const bar = tune.reduce((a, n) => a + n[1], 0) * 0.5;
    while (this.nextNote <= t) {
      const k = Math.floor(this.nextNote / bar);
      let at = k * bar;
      for (const [n, d] of tune) {
        const when = at - t;
        if (when >= -0.01) this.app.audio.note?.(n, d * 0.45, Math.max(0, when));
        at += d * 0.5;
      }
      this.nextNote = (k + 1) * bar;
    }
  }

  play(t, dt) {
    const left = Math.max(0, Math.ceil(AD_LENGTH - t));
    this.countEl.textContent = `Ad · 0:${String(left).padStart(2, '0')}`;
    const sk = Math.ceil(this.skipAt - t);
    if (sk > 0) { if (this.skipBtn.textContent !== 'Nice try' || sk < 4) this.skipBtn.textContent = `Skip in ${sk}`; }
    else if (!this.skipBtn.classList.contains('ready')) { this.skipBtn.textContent = 'Skip Ad ▸'; this.skipBtn.classList.add('ready'); }
    this.jingle(t + 0.4);
    this.burst.rotation.z = t * 0.3;
    // 0-3: HUNGRY?
    if (t < 3) this.caption('HUNGRY?', 'of course you are', 'huge');
    // 3-11: the stack builds itself, bouncing
    const build = (t - 3) / 7;
    this.layers.forEach((m, i) => {
      const at = i / this.layers.length;
      m.visible = t > 3 && build > at;
      const k = ease(build, at, at + 0.1);
      const bounce = Math.abs(Math.sin(k * Math.PI * 2)) * (1 - k) * 2;
      m.position.y = m.userData.y + (1 - k) * 12 + bounce;
      if (m.visible && k > 0.95) this.cue('land' + i, () => this.app.audio.play('boing'));
    });
    this.table.rotation.y = t * 0.6;
    if (t > 3 && t < 11) this.caption('THE POLY STACK', 'two patties · two cheeses · 1,284 polygons');
    // 11-17: glamour orbit and sparkles
    if (t > 11 && t < 17) {
      this.caption('NOW WITH 40% MORE POLYGONS', '');
      if (Math.random() < dt * 14) {
        const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.25), this.sparkMat);
        s.position.set((Math.random() - 0.5) * 9, 1 + Math.random() * 5, (Math.random() - 0.5) * 9);
        s.userData.life = 0.6;
        this.scene.add(s); this.sparkles.push(s);
      }
    }
    // 17-23: it drives
    if (t > 17 && t < 23) {
      this.table.visible = false;
      this.car.visible = true; this.ground.visible = true; this.burst.visible = false;
      this.scene.background = new THREE.Color(0x9fd0f0);
      const a = (t - 17) * 1.4;
      this.car.position.set(Math.cos(a) * 9, 0, Math.sin(a) * 9);
      this.car.rotation.y = -a;
      for (const w of this.wheels) w.rotation.x += dt * 14;
      if (Math.random() < dt * 8) this.puffs.push(puffBall(this.scene, this.car.position.clone().add(V(0, 0.4, 0)), { glow: false, color: 0xd8d8d8, size: 1.2, life: 0.8 }));
      this.caption('DRIVE-THRU?', 'no. DRIVE-IN-TO-IT.');
    }
    // 23-27: the price
    if (t > 23 && t < 27) {
      this.car.visible = false; this.ground.visible = false; this.table.visible = true; this.burst.visible = true;
      this.scene.background = new THREE.Color(0xffd23c);
      this.price.visible = true;
      this.price.scale.setScalar(1 + Math.sin(t * 8) * 0.06);
      this.caption('', '');
    }
    // 27-30: the slogan
    if (t > 27) {
      this.price.visible = false;
      this.caption('POLYBURGER', 'eat fast. drive faster.  *polygons not edible. may contain nuts (and bolts).');
    }
    for (let i = this.sparkles.length - 1; i >= 0; i--) { const s = this.sparkles[i]; s.userData.life -= dt; s.rotation.y += dt * 6; s.scale.setScalar(Math.max(0, s.userData.life) * 2); if (s.userData.life <= 0) { this.scene.remove(s); s.geometry.dispose(); this.sparkles.splice(i, 1); } }
    this.puffs = this.puffs.filter((f) => !f(dt));
    // camera
    if (t < 17 || t > 23) {
      const a = t * 0.5;
      const r = t > 23 && t < 27 ? 22 : 16;
      this.look(V(Math.sin(a) * r, 6 + Math.sin(t) * 1.5, Math.cos(a) * r), V(0, t > 23 && t < 27 ? 5 : 2.4, 0), 45);
    } else this.look(V(0, 11, 20), V(0, 0.5, 0), 50);
  }

  dispose() {
    super.dispose();
  }
}
