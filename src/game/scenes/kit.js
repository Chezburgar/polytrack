// Cutscenes: a little 3D film in its own scene, drawn instead of the race (the
// race carries on underneath, or waits, as the cutscene says), with captions,
// letterbox bars and a fade. Plus the low-poly cast they're built from: people,
// a giant cat, planets, a star field, a rocket.
import * as THREE from 'three';
import { h } from '../../ui/dom.js';
import { clamp, smoothstep, makeNoise2D, mulberry32 } from '../../util/math.js';

// ---- tweening helpers ---------------------------------------------------------------
// 0..1 across [a, b] with an ease
export const ease = (t, a, b) => smoothstep(a, b, t);
export const lin = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
export const mix = (a, b, k) => a + (b - a) * k;
export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ---- base -------------------------------------------------------------------------------
export class Cutscene {
  // pauses: the race waits while it plays (offline); skippable: Space / Esc / click
  constructor(app, { length, pauses = false, skippable = false }) {
    this.app = app;
    this.length = length;
    this.pauses = pauses;
    this.skippable = skippable;
    this.t = 0;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 6000);
    this.hemi = new THREE.HemisphereLight(0xdfeaff, 0x556050, 1.25);
    this.sun = new THREE.DirectionalLight(0xfff2e0, 2.4);
    this.sun.position.set(40, 80, 30);
    this.scene.add(this.hemi, this.sun);
    this.cap = null;
    this.el = h('div.cut',
      h('div.cut-bars', h('i'), h('i')),
      this.capEl = h('div.cut-cap'),
      this.subEl = h('div.cut-sub'),
      this.barEl = h('div.cut-progress', h('i'), h('span')),
      skippable ? h('div.cut-skip', 'Space to skip') : h('div.cut-skip', 'Watch this…'),
      this.fadeEl = h('div.cut-fade.on'));
    app.ui.root.append(this.el);
    requestAnimationFrame(() => this.fadeEl.classList.remove('on'));
    if (skippable) {
      this._key = (e) => { if (e.code === 'Space' || e.code === 'Escape' || e.code === 'Enter') { e.preventDefault(); e.stopPropagation(); this.skip(); } };
      this._click = () => this.skip();
      window.addEventListener('keydown', this._key, true);
      this.el.addEventListener('pointerdown', this._click);
    }
  }

  get done() { return this.t >= this.length; }

  skip() { if (this.t < this.length - 0.6) this.t = this.length - 0.6; }

  update(dt) {
    this.t = Math.min(this.length, this.t + dt);
    this.camera.aspect = this.app.renderer.camera.aspect;
    this.camera.updateProjectionMatrix();
    this.play(this.t, dt);
    this.fadeEl.classList.toggle('on', this.t > this.length - 0.5);
  }

  play() {}

  // a caption: big words, a line under them; only redraws when it changes
  caption(big, sub = '', style = '') {
    const key = big + '|' + sub + '|' + style;
    if (key === this.cap) return;
    this.cap = key;
    this.subEl.textContent = sub;
    // the big line pops in when it changes (not when only the line under it does)
    const head = big + '|' + style;
    if (head === this.capHead) return;
    this.capHead = head;
    this.capEl.className = 'cut-cap' + (style ? ' ' + style : '');
    this.capEl.textContent = big;
    if (big) { this.capEl.classList.remove('pop'); void this.capEl.offsetWidth; this.capEl.classList.add('pop'); }
  }

  progress(k, label) {
    this.barEl.classList.toggle('on', k != null);
    if (k == null) return;
    this.barEl.firstChild.style.transform = `scaleX(${clamp(k, 0, 1).toFixed(3)})`;
    this.barEl.lastChild.textContent = label;
  }

  look(pos, at, fov = 50) {
    const c = this.camera;
    c.position.copy(pos);
    c.lookAt(at);
    if (c.fov !== fov) { c.fov = fov; c.updateProjectionMatrix(); }
  }

  dispose() {
    if (this._key) window.removeEventListener('keydown', this._key, true);
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.map?.dispose(); m.dispose(); });
    });
    this.el.classList.add('leave');
    const el = this.el;
    setTimeout(() => el.remove(), 500);
  }
}

// ---- building blocks ---------------------------------------------------------------------
const lambert = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });
export const glowMat = (color, k = 2.5) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) });
export function box(w, h2, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h2, d), typeof color === 'object' ? color : lambert(color));
  m.position.set(x, y, z);
  return m;
}
export function ball(r, color, x = 0, y = 0, z = 0, detail = 1) {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, detail), typeof color === 'object' ? color : lambert(color));
  m.position.set(x, y, z);
  return m;
}
export function tube(r0, r1, len, color, seg = 10) {
  return new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, len, seg), typeof color === 'object' ? color : lambert(color));
}

// a text panel from a canvas (banners, signs)
export function textPanel(lines, w, h2, { bg = '#1f4aa8', fg = '#ffffff', sizes = [] } = {}) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = Math.max(32, Math.round((512 * h2) / w));
  const g = cv.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((t, i) => {
    g.font = `italic 900 ${((sizes[i] ?? 0.7) * cv.height) / lines.length}px Arial, sans-serif`;
    g.fillText(t, cv.width / 2, ((i + 0.5) / lines.length) * cv.height, cv.width * 0.92);
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h2), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
}

// A low-poly person, 1.8 m, feet at y=0. Joints to animate: hipL/hipR, shL/shR
// (rotation.x swings), and the whole group. astronaut: a round glass helmet.
export function person({ suit = 0xd8433a, trim = 0xf2f2f2, skin = 0xe8b88a, helmet = 0xf2f2f2, astronaut = false } = {}) {
  const g = new THREE.Group();
  const leg = (x) => {
    const hip = new THREE.Group();
    hip.position.set(x, 0.9, 0);
    hip.add(box(0.22, 0.85, 0.24, suit, 0, -0.43, 0), box(0.24, 0.12, 0.34, 0x222222, 0, -0.86, 0.05));
    g.add(hip);
    return hip;
  };
  const arm = (x) => {
    const sh = new THREE.Group();
    sh.position.set(x, 1.45, 0);
    sh.add(box(0.18, 0.62, 0.2, suit, 0, -0.3, 0), box(0.16, 0.14, 0.16, astronaut ? trim : 0x2a2a2a, 0, -0.66, 0));
    g.add(sh);
    return sh;
  };
  g.userData.hipL = leg(0.14); g.userData.hipR = leg(-0.14);
  g.add(box(0.56, 0.62, 0.32, suit, 0, 1.2, 0), box(0.58, 0.1, 0.34, trim, 0, 1.1, 0));
  g.userData.shL = arm(0.38); g.userData.shR = arm(-0.38);
  if (astronaut) {
    g.add(box(0.46, 0.5, 0.2, trim, 0, 1.25, -0.25)); // life support pack
    g.add(ball(0.3, lambert(0xf2f2f2), 0, 1.78, 0, 1));
    g.add(ball(0.24, new THREE.MeshLambertMaterial({ color: 0x2a3a5a, emissive: 0x223355, flatShading: true }), 0, 1.8, 0.1, 1));
  } else {
    g.add(ball(0.2, skin, 0, 1.72, 0, 1));
    const lid = ball(0.24, helmet, 0, 1.78, 0, 1);
    lid.scale.set(1, 0.85, 1.05);
    g.add(lid, box(0.36, 0.08, 0.1, 0x1a1a1a, 0, 1.74, 0.2));
  }
  return g;
}

// swing arms and legs; speed 0 stands still
export function walk(p, phase, amt = 0.7) {
  const u = p.userData, s = Math.sin(phase) * amt;
  u.hipL.rotation.x = s; u.hipR.rotation.x = -s;
  u.shL.rotation.x = -s * 0.8; u.shR.rotation.x = s * 0.8;
}

// A giant low-poly cat, sitting, facing +z, about 22 m to the ears. Joints:
// head, paw (the right front leg, pivot at the shoulder: rotation.x lifts it,
// rotation.z swings it across), tail (a chain; animate with wagTail).
export function cat({ fur = 0xf0913a, dark = 0xc0602a, belly = 0xfbe4c8 } = {}) {
  const g = new THREE.Group();
  const furM = lambert(fur), darkM = lambert(dark), bellyM = lambert(belly);
  const body = ball(6.5, furM, 0, 7.5, -1, 1); body.scale.set(1, 1.25, 1.15); g.add(body);
  const chest = ball(4.6, bellyM, 0, 8.5, 3.2, 1); chest.scale.set(1, 1.3, 0.8); g.add(chest);
  for (let i = 0; i < 4; i++) { const st = box(9.5, 0.9, 11, darkM, 0, 6 + i * 2.8, -2); st.scale.x = 1 - i * 0.12; g.add(st); }
  const haunch = (x) => { const m = ball(4, furM, x, 3.5, -2.5, 1); m.scale.set(0.9, 0.85, 1.2); g.add(m); g.add(ball(1.8, bellyM, x, 0.9, 1.8, 1)); };
  haunch(4.2); haunch(-4.2);
  // left front leg
  const legL = tube(1.3, 1.5, 9, furM); legL.position.set(2.4, 4.5, 4.5); g.add(legL);
  g.add(ball(1.9, bellyM, 2.4, 0.9, 5.2, 1));
  // right front leg on a shoulder pivot: this one swats
  const paw = new THREE.Group();
  paw.position.set(-2.4, 9, 4.2);
  const legR = tube(1.3, 1.5, 9, furM); legR.position.y = -4.5; paw.add(legR);
  const pad = ball(2.1, bellyM, 0, -8.8, 0.8, 1); paw.add(pad);
  paw.add(ball(0.6, 0xff9ab0, 0, -9.6, 1.9, 0));
  g.add(paw);
  // head
  const head = new THREE.Group();
  head.position.set(0, 17.5, 2.5);
  const skull = ball(5, furM, 0, 0, 0, 1); skull.scale.set(1.15, 0.95, 1); head.add(skull);
  const muzzle = ball(2.4, bellyM, 0, -1.6, 3.8, 1); muzzle.scale.set(1.3, 0.8, 0.8); head.add(muzzle);
  head.add(ball(0.55, 0xff7a9a, 0, -0.9, 5.2, 0));
  for (const x of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(2, 4, 4), furM); ear.position.set(x * 3.1, 4.6, -0.5); ear.rotation.z = -x * 0.35; head.add(ear);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.6, 4), lambert(0xffb0c0)); inner.position.set(x * 3.1, 4.3, 0.2); inner.rotation.z = -x * 0.35; head.add(inner);
    const eye = ball(1.25, lambert(0xd8f070), x * 2.1, 0.9, 4.1, 1); eye.scale.z = 0.5; head.add(eye);
    const pupil = box(0.45, 1.8, 0.4, 0x111111, x * 2.1, 0.9, 4.75); head.add(pupil);
    head.userData['pupil' + (x > 0 ? 'R' : 'L')] = pupil;
    for (const k of [-1, 0, 1]) { const w = box(5, 0.08, 0.08, 0xffffff, x * 4.6, -1.8 + k * 0.5, 4.6); w.rotation.z = x * k * 0.18; head.add(w); }
  }
  g.add(head);
  // tail: segments on a chain of pivots
  const tail = new THREE.Group();
  tail.position.set(0, 2, -8.5);
  let parent = tail;
  const segs = [];
  for (let i = 0; i < 7; i++) {
    const j = new THREE.Group();
    j.position.set(0, i ? 2.2 : 0, 0);
    const m = tube(0.9 - i * 0.06, 1 - i * 0.06, 2.4, i % 2 ? darkM : furM, 7); m.position.y = 1.1;
    j.add(m); parent.add(j); parent = j; segs.push(j);
  }
  tail.rotation.x = -1.1;
  g.add(tail);
  g.userData = { ...g.userData, head, paw, tail: segs };
  return g;
}

export function wagTail(c, t, amt = 0.25) {
  c.userData.tail.forEach((j, i) => { j.rotation.z = Math.sin(t * 2.2 - i * 0.6) * amt; j.rotation.x = 0.12 + Math.sin(t * 1.3 - i * 0.4) * 0.08; });
}

// a planet: faceted sphere coloured by noise bands
export function planet(r, kind, seed = 1) {
  const g = new THREE.IcosahedronGeometry(r, 3);
  const noise = makeNoise2D(seed);
  const p = g.attributes.position.array, col = [];
  const c = new THREE.Color();
  for (let i = 0; i < p.length; i += 9) {
    const x = (p[i] + p[i + 3] + p[i + 6]) / 3 / r, y = (p[i + 1] + p[i + 4] + p[i + 7]) / 3 / r, z = (p[i + 2] + p[i + 5] + p[i + 8]) / 3 / r;
    const n = noise.fbm(x * 2.2 + z * 1.3, y * 2.2 - z * 0.7, 3);
    if (kind === 'earth') {
      if (Math.abs(y) > 0.86) c.set(0xf4f8ff);
      else if (n > 0.08) c.set(n > 0.3 ? 0x8a7a50 : 0x4f9a3a);
      else c.set(n > -0.05 ? 0x3aa0d8 : 0x1f6ab8);
    } else if (kind === 'mars') {
      c.set(n > 0.2 ? 0x8a3a22 : n > -0.1 ? 0xc0582e : 0xd8784a);
      if (y > 0.9) c.set(0xf0e8e0);
    } else if (kind === 'jupiter' || kind === 'saturn' || kind === 'neptune') {
      // gas giants: bands by latitude, wobbled by the noise
      const band = Math.sin(y * 13 + n * 2.5);
      const pal = { jupiter: [0xd8b890, 0xa8683a, 0xf0e2c8], saturn: [0xe8d49a, 0xc8a868, 0xf4ead0], neptune: [0x3a6ad8, 0x2a4aa8, 0x6a9af0] }[kind];
      c.set(band > 0.35 ? pal[0] : band > -0.3 ? pal[1] : pal[2]);
      if (kind === 'jupiter' && Math.hypot(x - 0.5, y + 0.3) < 0.14) c.set(0xc0482a); // the great red spot
    } else if (kind === 'pluto') {
      // pale tan and ice, with the big heart
      c.set(n > 0.15 ? 0x8a6a50 : n > -0.1 ? 0xc8a888 : 0xe8d8c8);
      const hx = x - 0.35, hy = y + 0.05;
      if (z > 0 && (Math.hypot(hx - 0.13, hy - 0.1) < 0.2 || Math.hypot(hx + 0.13, hy - 0.1) < 0.2 || (Math.abs(hx) < 0.3 - (0.1 - hy) * 0.9 && hy < 0.1 && hy > -0.25))) c.set(0xf8f4f0);
    } else {
      c.set(n > 0.15 ? 0x8a8a90 : n > -0.1 ? 0xb0b0b6 : 0x9a9aa2);
    }
    c.multiplyScalar(0.94 + ((i * 7919) % 13) / 100);
    for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
}

export function stars(n = 2500, r = 3000, seed = 7) {
  const rnd = mulberry32(seed), pos = [];
  for (let i = 0; i < n; i++) {
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    pos.push(Math.cos(a) * s * r, u * r, Math.sin(a) * s * r);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false }));
}

// a rocket built round a car: returns the group and its parts in build order
export function rocket() {
  const g = new THREE.Group();
  const white = lambert(0xf2f2f2), red = lambert(0xe8433a), dark = lambert(0x3a3d44);
  const parts = [];
  for (let i = 0; i < 3; i++) { const ring = tube(2.9, 2.9, 2.3, i === 1 ? red : white, 14); ring.position.y = 1.2 + i * 2.3; parts.push(ring); }
  const cone = new THREE.Mesh(new THREE.ConeGeometry(2.9, 4.2, 14), red); cone.position.y = 1.2 + 3 * 2.3 - 1.15 + 2.1; parts.push(cone);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const fin = box(0.3, 3, 2.4, red); fin.position.set(Math.sin(a) * 3.4, 1.2, Math.cos(a) * 3.4); fin.rotation.y = a; parts.push(fin);
  }
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 3;
    const bell = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.6, 10, 1, true), dark); bell.position.set(Math.sin(a) * 1.5, -0.6, Math.cos(a) * 1.5); parts.push(bell);
  }
  const porthole = ball(0.9, new THREE.MeshLambertMaterial({ color: 0x5ad8ff, emissive: 0x1a5a8a, flatShading: true }), 0, 5.8, 2.75, 1); porthole.scale.z = 0.4; parts.push(porthole);
  for (const p of parts) g.add(p);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(2, 7, 12, 1, true), glowMat(0xffa040, 3));
  flame.rotation.x = Math.PI; flame.position.y = -4.5; flame.visible = false;
  g.add(flame);
  g.userData = { parts, flame };
  return g;
}

// ground with a little noise, coloured from a palette; mask(x, z) 0..1 flattens
// it where things stand (a road, a crash site)
export function terrain(size, seg, colors, amp, seed = 3, mask = null) {
  const g = new THREE.PlaneGeometry(size, size, seg, seg).toNonIndexed();
  g.rotateX(-Math.PI / 2);
  const noise = makeNoise2D(seed), rnd = mulberry32(seed);
  const p = g.attributes.position.array;
  for (let i = 0; i < p.length; i += 3) p[i + 1] = noise.fbm(p[i] / 60, p[i + 2] / 60, 3) * amp * (mask ? mask(p[i], p[i + 2]) : 1) - (mask ? 0.05 : 0);
  const col = [], c = new THREE.Color();
  for (let i = 0; i < p.length; i += 9) { c.set(colors[Math.floor(rnd() * colors.length)]); for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
}

// a fireball / dust puff that grows and fades: call tick(dt), true when spent
export function puffBall(scene, pos, { color = 0xffa040, glow = true, size = 4, life = 0.8, rise = 2 } = {}) {
  const mat = glow ? new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.5), transparent: true }) : lambert(color, { transparent: true });
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), mat);
  m.position.copy(pos);
  scene.add(m);
  let age = 0;
  return (dt) => {
    age += dt;
    const k = age / life;
    m.scale.setScalar(size * (0.3 + 0.7 * Math.sqrt(Math.min(1, k * 1.5))));
    m.position.y += rise * dt;
    mat.opacity = 1 - k;
    if (k >= 1) { scene.remove(m); m.geometry.dispose(); mat.dispose(); return true; }
    return false;
  };
}
