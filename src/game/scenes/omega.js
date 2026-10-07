// /1v1, lost: the omega yeet - a 120 second film. The cat goes beyond (floating,
// glowing, lightning) and blasts the car out of the galaxy, 20,000,000,000,000,000,000,000
// km to the star Nexus. The locals land, decide the driver needs training and fly
// them to a training camp in the mountains of Dagestan. Three years of montage;
// "training complete"; the car drives off and falls straight over. Three more
// years. Finally strong enough to flip it back one-handed, and off the mountain,
// all the way home to the track.
import * as THREE from 'three';
import { buildCar } from '../../car/model.js';
import { makeProp } from '../../render/props.js';
import { mulberry32, smoothstep } from '../../util/math.js';
import { Cutscene, person, walk, cat, wagTail, planet, stars, terrain, box, ball, tube, glowMat, puffBall, alien, ufo, ease, lin, mix, V } from './kit.js';

export const OMEGA_LENGTH = 120;
const BLAST = 10, WARP = 15, NEXUS = 33, ALIENS = 40, TRIP = 48, DAG = 52, Y1 = 56, Y2 = 62, Y3 = 68, FAIL = 74, Y4 = 86, Y5 = 92, Y6 = 98, STRONG = 104, HOME = 112;
const DIST = 2e22; // km to Nexus
const SKY = new THREE.Color(0x9fd0f0), BLACK = new THREE.Color(0x02030a);
const km = (x) => Math.round(x).toLocaleString('en-US');

export class OmegaYeetScene extends Cutscene {
  constructor(app, victim, opts = {}) {
    super(app, { length: OMEGA_LENGTH, ...opts });
    this.name = (victim.name || 'Racer').replace(/\s*\(AI\)$/, '');
    this.rnd = mulberry32(21);
    this.car = buildCar(victim.custom, { shadows: false });
    this.scene.add(this.car.group);
    this.driver = person({ suit: new THREE.Color(victim.custom?.paint || '#e8433a').getHex(), trim: 0xf2f2f2 });
    this.driver.visible = false;
    this.scene.add(this.driver);
    this.buildTrack();
    this.buildSpace();
    this.buildNexus();
    this.buildDagestan();
    this.puffs = [];
    this.cues = new Set();
    this.nextNote = 0;
  }

  cue(n, fn) { if (!this.cues.has(n)) { this.cues.add(n); fn(); } }

  // ---- sets ------------------------------------------------------------------------------
  buildTrack() {
    const g = (this.trackSet = new THREE.Group());
    g.add(terrain(600, 60, [0x6fae45, 0x7cb850, 0x64a03e], 5, 31, (x, z) => smoothstep(9, 30, Math.abs(x + 2)) * smoothstep(12, 26, Math.hypot(x - 13, z - 44))));
    g.add(box(12, 0.3, 700, 0x4b4f59, -2, 0.1, 150));
    for (let z = -150; z < 450; z += 8) g.add(box(0.3, 0.02, 4, 0xf2f2f2, -2, 0.27, z));
    for (const x of [-8.3, 4.3]) for (let z = -150; z < 450; z += 3) g.add(box(0.6, 0.25, 3, (z / 3) % 2 ? 0xe8433a : 0xf5f5f5, x, 0.15, z));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    for (let i = 0; i < 50; i++) {
      const t = new THREE.Mesh(makeProp(this.rnd() < 0.5 ? 'pine' : 'oak', this.rnd), mat);
      t.position.set((i % 2 ? 1 : -1) * (30 + this.rnd() * 140), 0, -100 + this.rnd() * 500);
      t.scale.setScalar(1.2 + this.rnd());
      g.add(t);
    }
    // the cat, gone beyond: an aura, glowing eyes, lightning, rocks lifting off the ground
    this.cat = cat({ fur: 0xf0b03a, dark: 0xd0802a });
    this.cat.position.set(13, 0, 44);
    this.cat.rotation.y = -Math.PI / 2;
    const head = this.cat.userData.head;
    for (const x of [-1, 1]) head.add(ball(1.15, glowMat(0x7af0ff, 3), x * 2.1, 0.9, 4.35, 1));
    this.aura = new THREE.Mesh(new THREE.IcosahedronGeometry(16, 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb020), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.aura.position.y = 11;
    this.cat.add(this.aura);
    this.orb = ball(1, glowMat(0x9af0ff, 3.5), 0, -9, 1.5, 1); // charging in the paw
    this.orb.visible = false;
    this.cat.userData.paw.add(this.orb);
    this.bolts = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: new THREE.Color(0xbaf4ff).multiplyScalar(3) }));
    this.bolts.geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6 * 40), 3));
    g.add(this.bolts);
    this.rocks = [];
    for (let i = 0; i < 18; i++) { const r = ball(0.5 + this.rnd() * 1.2, 0x8a8278, 13 + (this.rnd() - 0.5) * 36, 0, 44 + (this.rnd() - 0.5) * 36, 0); r.userData.v = 1 + this.rnd() * 2.5; g.add(r); this.rocks.push(r); }
    this.beam = tube(1.6, 1.6, 1, glowMat(0xaaf6ff, 3.2), 12);
    this.beam.visible = false;
    g.add(this.beam);
    g.add(this.cat);
    this.scene.add(g);
  }

  buildSpace() {
    const g = (this.spaceSet = new THREE.Group());
    g.add(stars(3000, 3500, 13));
    // warp streaks: lines in a tube round the camera, rushing past
    const n = 260, pos = new Float32Array(n * 6);
    this.streak = [];
    for (let i = 0; i < n; i++) { const a = this.rnd() * Math.PI * 2, r = 25 + this.rnd() * 140; this.streak.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, z: -600 + this.rnd() * 1200 }); }
    this.warp = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: new THREE.Color(0xcfe4ff).multiplyScalar(2), transparent: true, opacity: 0.8 }));
    this.warp.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.warp.frustumCulled = false;
    g.add(this.warp);
    // the Milky Way, from outside: two spiral arms of stars
    const gp = [], gc = [], c = new THREE.Color();
    for (let i = 0; i < 6000; i++) {
      const arm = i % 2, r = Math.pow(this.rnd(), 0.6) * 900, a = r * 0.009 + arm * Math.PI + (this.rnd() - 0.5) * 0.6;
      gp.push(Math.cos(a) * r, (this.rnd() - 0.5) * 30 * (1 - r / 900), Math.sin(a) * r);
      c.setHSL(r < 200 ? 0.11 : 0.6, 0.6, 0.6 + this.rnd() * 0.3);
      gc.push(c.r, c.g, c.b);
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
    gg.setAttribute('color', new THREE.Float32BufferAttribute(gc, 3));
    this.galaxy = new THREE.Points(gg, new THREE.PointsMaterial({ vertexColors: true, size: 2.4, sizeAttenuation: false }));
    this.galaxy.rotation.x = 0.5;
    g.add(this.galaxy);
    this.earth = planet(300, 'earth', 2);
    this.earth.visible = false;
    g.add(this.earth);
    this.ship = ufo();
    this.ship.visible = false;
    this.scene.add(this.ship);
    g.visible = false;
    this.scene.add(g);
  }

  buildNexus() {
    const g = (this.nexusSet = new THREE.Group());
    g.add(terrain(900, 60, [0x5a3a8a, 0x4a2e78, 0x6a4a9a, 0x3a2a68], 7, 41, (x, z) => smoothstep(16, 50, Math.hypot(x, z))));
    g.add(stars(2000, 3000, 17));
    // Nexus itself: an enormous blue-white star filling the sky
    this.nexus = ball(420, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xcfe8ff).multiplyScalar(2.4), fog: false }), -300, 650, -2200, 3);
    const corona = ball(560, new THREE.MeshBasicMaterial({ color: new THREE.Color(0x6ab8ff).multiplyScalar(1.3), transparent: true, opacity: 0.25, depthWrite: false, fog: false }), -300, 650, -2200, 2);
    g.add(this.nexus, corona);
    for (let i = 0; i < 40; i++) {
      const cr = new THREE.Mesh(new THREE.ConeGeometry(0.6 + this.rnd(), 2 + this.rnd() * 5, 5), glowMat(i % 2 ? 0x9a6aff : 0x5affd8, 1.6));
      const a = this.rnd() * Math.PI * 2, r = 18 + this.rnd() * 160;
      cr.position.set(Math.cos(a) * r, 1, Math.sin(a) * r);
      cr.rotation.set((this.rnd() - 0.5) * 0.5, 0, (this.rnd() - 0.5) * 0.5);
      g.add(cr);
    }
    this.crater = new THREE.Mesh(new THREE.CircleGeometry(7, 16), new THREE.MeshLambertMaterial({ color: 0x2a1a48 }));
    this.crater.rotation.x = -Math.PI / 2; this.crater.position.y = 0.3;
    g.add(this.crater);
    this.aliens = [0x7ae85a, 0x5ad8a8, 0xa8e85a].map((c) => { const a = alien(c); a.visible = false; g.add(a); return a; });
    g.visible = false;
    this.scene.add(g);
  }

  buildDagestan() {
    const g = (this.dagSet = new THREE.Group());
    g.add(terrain(1200, 70, [0x6a9a4a, 0x5a8a3e, 0x7aa858, 0x8a8a70], 9, 51, (x, z) => smoothstep(25, 70, Math.hypot(x, z + 20))));
    // the mountains: rock with snow on top, all the way round
    const rock = new THREE.MeshLambertMaterial({ color: 0x7a7870, flatShading: true }), green = new THREE.MeshLambertMaterial({ color: 0x5a8040, flatShading: true }), snow = new THREE.MeshLambertMaterial({ color: 0xf4f6fa, flatShading: true });
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + this.rnd() * 0.2, r = 260 + this.rnd() * 260, ht = 160 + this.rnd() * 260, rad = 90 + this.rnd() * 110;
      const m = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ConeGeometry(rad, ht, 6 + (i % 3)), i % 3 ? rock : green);
      body.position.y = ht / 2 - 5;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.3, ht * 0.3, 6 + (i % 3)), snow);
      cap.position.y = ht * 0.85 - 5;
      m.add(body, cap);
      m.position.set(Math.cos(a) * r, 0, Math.sin(a) * r - 20);
      m.rotation.y = this.rnd() * 3;
      g.add(m);
    }
    // a stone village on the hillside
    for (let i = 0; i < 14; i++) {
      const hx = -70 + (i % 7) * 13 + this.rnd() * 4, hz = -70 - Math.floor(i / 7) * 14, hy = Math.floor(i / 7) * 5;
      g.add(box(9, 6, 8, i % 2 ? 0xc8b898 : 0xb8a888, hx, hy + 3, hz), box(9.6, 0.6, 8.6, 0x8a7a68, hx, hy + 6.3, hz));
      g.add(box(1.4, 1.8, 0.2, 0x5a4030, hx, hy + 0.9, hz + 4.05));
    }
    // the mountain path (a long ramp up the hillside) and the wrestling mat
    this.path = { a: V(-34, 0, 30), b: V(-34, 28, -46) };
    const len = this.path.a.distanceTo(this.path.b);
    const slope = box(5, 0.6, len, 0x9a8a72);
    slope.position.copy(this.path.a).lerp(this.path.b, 0.5).add(V(0, -0.3, 0));
    slope.rotation.x = Math.atan2(this.path.b.y - this.path.a.y, this.path.a.z - this.path.b.z);
    g.add(slope);
    g.add(box(18, 28, 14, 0x7a7870, -34, 14, -54)); // the crag it climbs to
    const mat = box(8, 0.16, 8, 0x2a5ad8, 0, 0.08, 0);
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 3, 32), new THREE.MeshBasicMaterial({ color: 0xe8433a }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.17;
    g.add(mat, ring);
    // a rock to drive into, and a ramp off the mountain for the way home
    this.rock = ball(1.6, 0x7a7266, 22, 0.6, 0, 0);
    this.rock.scale.y = 0.6;
    g.add(this.rock);
    const kick = box(6, 0.6, 24, 0x9a8a72, 40, 3, -20);
    kick.rotation.x = 0.28;
    g.add(kick);
    // the coach: tracksuit, beard, arms folded
    this.coach = person({ suit: 0x26262c, trim: 0xe8433a, helmet: 0x1a1a1a });
    this.coach.add(box(0.34, 0.16, 0.14, 0x1a1a1a, 0, 1.6, 0.14));
    g.add(this.coach);
    g.visible = false;
    this.scene.add(g);
  }

  setAct(name) {
    if (this.act === name) return;
    this.act = name;
    const sc = this.scene;
    this.trackSet.visible = name === 'track';
    this.spaceSet.visible = name === 'space';
    this.nexusSet.visible = name === 'nexus';
    this.dagSet.visible = name === 'dag';
    this.sun.intensity = 2.4;
    if (name === 'track') { sc.background = SKY.clone(); sc.fog = new THREE.Fog(0xbfe3f7, 150, 700); this.hemi.intensity = 1.25; }
    if (name === 'space') { sc.background = BLACK.clone(); sc.fog = null; this.hemi.intensity = 0.6; }
    if (name === 'nexus') { sc.background = new THREE.Color(0x0a0618); sc.fog = new THREE.Fog(0x1a1030, 200, 900); this.hemi.intensity = 1.0; this.sun.intensity = 2; }
    if (name === 'dag') { sc.background = new THREE.Color(0x8ec4ec); sc.fog = new THREE.Fog(0xb8d8f0, 300, 1100); this.hemi.intensity = 1.2; }
  }

  // the training montage music: a stubborn little riff
  riff(t) {
    const tune = [45, 45, 52, 45, 48, 45, 52, 55];
    const step = 0.3;
    while (this.nextNote <= t) {
      const i = Math.round(this.nextNote / step);
      if (this.nextNote > t - 0.05) this.app.audio.note?.(tune[i % tune.length], 0.2, 0);
      this.nextNote = (i + 1) * step;
    }
  }

  // ---- the film ------------------------------------------------------------------------------
  play(t, dt) {
    const montage = (t > Y1 && t < FAIL) || (t > Y4 && t < STRONG);
    if (montage) this.riff(t); else this.nextNote = t;
    if (t < BLAST) this.actPower(t, dt);
    else if (t < WARP) this.actBlast(t, dt);
    else if (t < NEXUS) this.actWarp(t, dt);
    else if (t < ALIENS) this.actNexus(t, dt);
    else if (t < TRIP) this.actAliens(t, dt);
    else if (t < DAG) this.actTrip(t, dt);
    else if (t < Y1) this.actArrive(t, dt);
    else if (t < FAIL) this.actTraining(t, dt, 1);
    else if (t < Y4) this.actFail(t, dt);
    else if (t < STRONG) this.actTraining(t, dt, 2);
    else if (t < HOME) this.actStrong(t, dt);
    else this.actHome(t, dt);
    this.puffs = this.puffs.filter((f) => !f(dt));
  }

  // 0-10: the cat powers up
  actPower(t, dt) {
    this.setAct('track');
    const a = this.app.audio, c = this.car.group, u = this.cat.userData;
    c.position.set(-2, 0.62, 40); c.rotation.set(0, 0, 0);
    this.cat.position.y = 7 * ease(t, 2, 8) + Math.sin(t * 2) * 0.4 * ease(t, 3, 5);
    wagTail(this.cat, t, 0.5);
    u.head.rotation.x = -0.25 * ease(t, 1, 3);
    this.aura.material.opacity = 0.22 * ease(t, 2, 6) * (0.85 + Math.random() * 0.15);
    this.aura.scale.setScalar(1 + Math.sin(t * 12) * 0.03);
    for (const r of this.rocks) { r.position.y = Math.max(0, (t - 3) * r.userData.v * 1.6); r.rotation.y += dt; }
    this.lightning(t > 4 ? 1 : 0.4);
    this.cue('charge', () => a.play('charge'));
    if (t > 6) this.cue('thunder', () => a.thunder?.(80));
    this.caption(t < 4 ? 'THE CAT IS BACK' : 'OMEGA FORM', t < 4 ? 'and it has gone… beyond' : 'power level: yes', t < 4 ? '' : 'huge');
    const k = ease(t, 0, 10);
    this.look(V(-14 - k * 8, 2 + k * 3, 18), V(10, 10 + k * 6, 44), 55);
  }

  lightning(amt) {
    const p = this.bolts.geometry.attributes.position.array, n = p.length / 6;
    const cx = this.cat.position.x, cy = this.cat.position.y + 11, cz = this.cat.position.z;
    for (let i = 0; i < n; i++) {
      if (Math.random() > amt) { p.fill(0, i * 6, i * 6 + 6); continue; }
      const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI - Math.PI / 2, r = 14 + Math.random() * 6;
      const x = cx + Math.cos(a) * Math.cos(b) * r, y = cy + Math.sin(b) * r, z = cz + Math.sin(a) * Math.cos(b) * r;
      p.set([x, y, z, x + (Math.random() - 0.5) * 6, y + (Math.random() - 0.5) * 6, z + (Math.random() - 0.5) * 6], i * 6);
    }
    this.bolts.geometry.attributes.position.needsUpdate = true;
    this.bolts.visible = amt > 0;
  }

  // 10-15: the blast
  actBlast(t, dt) {
    this.setAct('track');
    const a = this.app.audio, c = this.car.group, u = this.cat.userData, k = t - BLAST;
    this.lightning(1);
    this.aura.material.opacity = 0.24;
    u.paw.rotation.x = -2.2 * ease(k, 0, 0.8) + 1.4 * ease(k, 1.1, 1.3);
    this.orb.visible = k < 1.3;
    this.orb.scale.setScalar(0.5 + ease(k, 0, 1.1) * 2.5 + Math.random() * 0.3);
    if (k < 1.2) {
      c.position.set(-2, 0.62, 40);
      this.caption('', '');
      this.look(V(-16, 4, 26), V(8, 9, 42), 52);
    } else {
      const s = k - 1.2;
      this.cue('blast', () => { a.play('beam'); a.play('yeet'); this.caption('OMEGA YEET', '', 'huge'); });
      // the beam, paw to car, and the car going up it at a silly speed
      const from = this.orb.getWorldPosition(V());
      c.position.set(-2 - s * 30, 0.62 + s * s * 120, 40 + s * 40);
      c.rotation.set(s * 12, s * 6, s * 15);
      const to = c.position;
      this.beam.visible = s < 1.2;
      this.beam.position.copy(from).lerp(to, 0.5);
      this.beam.scale.set(1 - s * 0.6, from.distanceTo(to), 1 - s * 0.6);
      this.beam.quaternion.setFromUnitVectors(V(0, 1, 0), to.clone().sub(from).normalize());
      if (s < 0.3) this.look(V(-16, 4, 26), V(0, 8, 40), 52);
      else this.look(V(-14, 6, 30), c.position, 55);
      this.scene.background.lerpColors(SKY, BLACK, ease(s, 1.5, 3.4));
      if (s > 2.2) this.caption('OMEGA YEET', `bye ${this.name}. very bye.`, 'huge');
    }
  }

  // 15-33: out of the galaxy at warp, 20,000,000,000,000,000,000,000 km
  actWarp(t, dt) {
    this.setAct('space');
    const c = this.car.group, k = (t - WARP) / (NEXUS - WARP);
    c.position.set(0, 0, 0);
    c.rotation.set(t * 1.6, t, t * 2);
    const speed = 300 + 2600 * ease(k, 0.05, 0.4);
    const p = this.warp.geometry.attributes.position.array;
    this.streak.forEach((s, i) => {
      s.z -= speed * dt;
      if (s.z < -600) s.z += 1200;
      const len = 4 + speed * 0.03;
      p.set([s.x, s.y, s.z, s.x, s.y, s.z + len], i * 6);
    });
    this.warp.geometry.attributes.position.needsUpdate = true;
    this.warp.material.opacity = 0.8 * ease(k, 0, 0.15);
    // the galaxy falls away behind
    this.galaxy.visible = k > 0.15 && k < 0.75;
    this.galaxy.position.set(-700, -500, mix(800, -3000, ease(k, 0.15, 0.75)));
    this.galaxy.rotation.y = t * 0.05;
    const d = DIST * Math.pow(k, 4);
    const sub = `${km(d)} km`;
    if (k < 0.2) this.caption('LEAVING THE SOLAR SYSTEM', sub);
    else if (k < 0.55) this.caption('LEAVING THE MILKY WAY', sub);
    else this.caption('NEXT STOP: NEXUS', sub);
    this.cue('warp', () => this.app.audio.play('warp'));
    this.look(V(-5, 3, -12), V(0, 0, 20), 60);
  }

  // 33-40: the star Nexus, and a crash landing on a planet beside it
  actNexus(t, dt) {
    this.setAct('nexus');
    const a = this.app.audio, c = this.car.group, k = t - NEXUS;
    if (k < 1.2) {
      const u = k / 1.2;
      c.position.set(mix(-120, 0, u), mix(170, 1.1, u * u), mix(-90, 0, u));
      c.rotation.set(t * 4, t * 2, t * 5);
      if (Math.random() < 0.9) this.puffs.push(puffBall(this.scene, c.position.clone().add(V(-4, 5, -3)), { color: 0x7ac8ff, size: 2.4, life: 0.4, rise: 0 }));
      this.look(V(c.position.x + 24, c.position.y - 4, c.position.z + 28), c.position, 50);
      this.caption('NEXUS', '20,000,000,000,000,000,000,000 km from home');
    } else {
      this.cue('land', () => { a.play('crash'); for (let i = 0; i < 10; i++) { const ang = (i / 10) * Math.PI * 2; this.puffs.push(puffBall(this.scene, V(Math.cos(ang) * 9, 0.4, Math.sin(ang) * 9), { glow: false, color: 0x8a6ac8, size: 1.6, life: 1, rise: 3 })); } });
      c.position.set(0, 1.1, 0);
      c.rotation.set(0, 0.6, Math.PI);
      this.caption('NEXUS', 'about 2 billion light years from the track');
      const o = 0.3 + k * 0.08;
      this.look(V(Math.sin(o) * 26, 7, Math.cos(o) * 26), V(-20, 18, -60), 55); // the car small, the star huge
    }
  }

  // 40-48: the locals arrive, have a think, and beam the car up
  actAliens(t, dt) {
    this.setAct('nexus');
    const a = this.app.audio, k = t - ALIENS, sh = this.ship, u = sh.userData, c = this.car.group;
    sh.visible = true;
    const land = ease(k, 0, 2.2);
    sh.position.set(-22, mix(60, 7, land), -8);
    sh.rotation.y = (1 - land) * 12;
    u.lights.forEach((l, i) => { l.visible = Math.floor(t * 8 + i) % 2 === 0; });
    this.cue('ufo', () => a.play('ufo'));
    this.aliens.forEach((al, i) => {
      const go = ease(k, 2.2 + i * 0.4, 3.8 + i * 0.4);
      al.visible = k > 2.2 + i * 0.4;
      al.position.set(mix(-22, -8 + i * 3, go), 0, mix(2, -4 + i * 2.2, go));
      al.lookAt(0, 0, 0);
      walk(al, t * 9, go > 0 && go < 1 ? 0.7 : 0);
      al.userData.shR.rotation.x = go >= 1 ? -1.4 + Math.sin(t * 3 + i) * 0.3 : 0; // pointing, discussing
    });
    if (k > 3) this.cue('talk', () => a.play('alien'));
    // they beam it up
    u.beam.visible = k > 5.2;
    if (k > 5.2) {
      sh.position.x = mix(-22, 0, ease(k, 4.6, 5.2));
      const up = ease(k, 5.4, 7.6);
      c.position.set(0, 1.1 + up * 4, 0);
      c.rotation.set(0, 0.6 + up * 4, Math.PI * (1 - up));
      this.cue('beam', () => a.play('ufo'));
    } else { c.position.set(0, 1.1, 0); c.rotation.set(0, 0.6, Math.PI); }
    if (k > 4.6) sh.position.x = mix(-22, 0, ease(k, 4.6, 5.2));
    this.caption(k < 3 ? 'COMPANY' : 'THE LOCALS HAVE A PLAN', k < 3 ? '' : k < 5.4 ? '"this one needs training"' : '"serious training"');
    this.look(V(16, 8, 22), V(-6, 4, -2), 52);
  }

  // 48-52: across the universe by UFO, to Earth
  actTrip(t, dt) {
    this.setAct('space');
    const k = (t - TRIP) / (DAG - TRIP), sh = this.ship;
    this.car.group.visible = false; // aboard
    for (const al of this.aliens) al.visible = false;
    sh.visible = true;
    sh.position.set(0, 0, 0);
    sh.rotation.set(0.2, t * 3, 0);
    sh.userData.beam.visible = false;
    const p = this.warp.geometry.attributes.position.array;
    this.streak.forEach((s, i) => { s.z -= 2600 * dt; if (s.z < -600) s.z += 1200; p.set([s.x, s.y, s.z, s.x, s.y, s.z + 80], i * 6); });
    this.warp.geometry.attributes.position.needsUpdate = true;
    this.warp.material.opacity = 0.8 * (1 - ease(k, 0.7, 1));
    this.galaxy.visible = false;
    this.earth.visible = true;
    this.earth.position.set(60, -40, mix(3000, 500, ease(k, 0.3, 1)));
    this.earth.rotation.y = t * 0.2;
    this.caption('DESTINATION: DAGESTAN', 'the aliens know a guy');
    this.look(V(14, 6, -22), V(0, 0, 30), 55);
  }

  // 52-56: dropped off in the mountains, where the coach is waiting
  actArrive(t, dt) {
    this.setAct('dag');
    const a = this.app.audio, k = t - DAG, sh = this.ship, c = this.car.group, d = this.driver;
    sh.visible = true;
    sh.rotation.set(0, t * 0.5, 0);
    sh.position.set(10, mix(80, 14, ease(k, 0, 1.5)) + ease(k, 2.8, 4) * 120, 6);
    sh.userData.beam.visible = k > 1.5 && k < 2.8;
    c.visible = k > 1.6;
    c.position.set(10, mix(8, 0.62, ease(k, 1.6, 2.6)), 6);
    c.rotation.set(0, -0.8, 0);
    d.visible = k > 2.4;
    d.position.set(7, 0, 4);
    d.lookAt(0, 0, 0);
    walk(d, 0, 0);
    this.coach.position.set(0, 0, -2);
    this.coach.lookAt(d.position.x, 0, d.position.z);
    this.folded(this.coach);
    if (k > 1.5) this.cue('drop', () => a.play('clunk'));
    this.caption('DAGESTAN', 'the toughest training camp in the universe');
    this.look(V(14, 6, 22), V(4, 3, 0), 50);
  }

  folded(p) { const u = p.userData; u.shL.rotation.set(-1.3, 0, 0.6); u.shR.rotation.set(-1.3, 0, -0.6); }
  relax(p) { const u = p.userData; u.shL.rotation.set(0, 0, 0); u.shR.rotation.set(0, 0, 0); u.hipL.rotation.set(0, 0, 0); u.hipR.rotation.set(0, 0, 0); p.rotation.set(0, p.rotation.y, 0); }

  // the montages: three years, then three more
  actTraining(t, dt, round) {
    this.setAct('dag');
    const d = this.driver, co = this.coach, c = this.car.group;
    const starts = round === 1 ? [Y1, Y2, Y3] : [Y4, Y5, Y6];
    const shot = t < starts[1] ? 0 : t < starts[2] ? 1 : 2;
    const k = t - starts[shot];
    const year = (round - 1) * 3 + shot + 1;
    this.ship.visible = false;
    d.visible = true;
    this.relax(d); this.relax(co);
    c.visible = true; c.rotation.set(0, -0.8, 0); c.position.set(10, 0.62, 6);
    const along = (u) => this.path.a.clone().lerp(this.path.b, u).add(V(0, 0.3, 0));
    const lines = round === 1
      ? [['running up mountains', 'every morning. before breakfast.'], ['carrying the car up', 'the car did not help'], ['wrestling the coach', 'losing, mostly']]
      : [['car presses', '500 a day'], ['push-ups', 'with the car on'], ['wrestling the coach', 'winning, finally']];
    this.caption(`YEAR ${year}`, lines[shot].join(' · '));
    if (k < 0.1) this.cue('year' + year, () => this.app.audio.play('ding'));
    if (round === 1 && shot < 2) {
      // up the mountain path (carrying the car in year 2)
      const u = (k / 6) * (shot ? 0.6 : 1);
      d.position.copy(along(Math.min(1, u)));
      d.rotation.set(0, Math.PI, 0);
      walk(d, t * (shot ? 7 : 13), shot ? 0.5 : 0.9);
      if (shot) { c.position.copy(d.position).add(V(0, 2.6, 0)); c.rotation.set(0, Math.PI / 2, 0); d.userData.shL.rotation.x = d.userData.shR.rotation.x = Math.PI; }
      co.position.copy(along(Math.min(1, u + 0.06))).add(V(3.5, 0, 0));
      co.lookAt(d.position.x, co.position.y, d.position.z);
      co.userData.shR.rotation.x = -1.6 + Math.sin(t * 6) * 0.3; // shouting, pointing up the hill
      this.look(d.position.clone().add(V(12, 4, 8)), d.position.clone().add(V(0, 1.5, -2)), 50);
    } else if (shot === 2) {
      // wrestling on the mat: round one the coach throws you, round two you throw the coach
      const thrower = round === 1 ? co : d, thrown = round === 1 ? d : co;
      const cyc = k % 2, throwK = ease(cyc, 1.1, 1.5);
      thrower.position.set(-0.7, 0, 0); thrown.position.set(0.7, 0, 0);
      thrower.lookAt(thrown.position); thrown.lookAt(thrower.position);
      for (const p of [d, co]) { p.rotateX(0.35 * (1 - throwK)); p.userData.shL.rotation.x = p.userData.shR.rotation.x = -1.4; walk(p, t * 8, 0.25 * (1 - throwK)); }
      // over the hip and down
      thrown.position.set(mix(0.7, -1.4, throwK), mix(0, 0.3, Math.sin(throwK * Math.PI)) + throwK * 0.2, 0);
      thrown.rotation.z = -throwK * Math.PI / 2 * (thrown === d ? 1 : -1);
      if (cyc > 1.5 && cyc < 1.6) this.cue('slam' + year + Math.floor(k / 2), () => this.app.audio.play('slam'));
      this.look(V(5, 3, 6), V(0, 0.8, 0), 45);
    } else if (shot === 0) {
      // car presses
      const press = Math.abs(Math.sin(k * 2.2));
      d.position.set(2, 0, 2); d.rotation.set(0, -0.6, 0);
      c.position.set(2, 2.0 + press * 0.45, 2); c.rotation.set(0, 0.97, 0);
      d.userData.shL.rotation.x = d.userData.shR.rotation.x = Math.PI - (1 - press) * 0.5;
      co.position.set(-2, 0, 4); co.lookAt(2, 0, 2); this.folded(co);
      this.look(V(9, 3, 10), V(1, 2, 2), 48);
    } else {
      // push-ups with the car on
      const up = Math.abs(Math.sin(k * 2.6));
      d.position.set(2, 0.3 + up * 0.35, 2);
      d.rotation.set(-Math.PI / 2 + 0.12, 0.3, 0, 'YXZ');
      d.userData.shL.rotation.x = d.userData.shR.rotation.x = Math.PI / 2 + 0.2;
      c.position.set(2 - Math.sin(0.3) * 0.6, 1.4 + up * 0.35, 2 - Math.cos(0.3) * 0.6); c.rotation.set(0, 0.3, 0);
      co.position.set(-1.5, 0, 4.5); co.lookAt(2, 0, 2); co.userData.shR.rotation.x = -1.6;
      this.look(V(8, 2.5, 8), V(1.5, 1, 1.5), 45);
    }
  }

  // 74-86: "training complete" - and it falls straight over
  actFail(t, dt) {
    this.setAct('dag');
    const a = this.app.audio, k = t - FAIL, d = this.driver, co = this.coach, c = this.car.group;
    this.relax(d); this.relax(co);
    co.position.set(4, 0, 4);
    if (k < 2) {
      d.visible = true; d.position.set(8, 0, 4.5); d.lookAt(c.position);
      c.position.set(10, 0.62, 6); c.rotation.set(0, -Math.PI / 2, 0);
      co.lookAt(d.position); co.userData.shR.rotation.x = -0.9; // a nod, a handshake
      this.caption('TRAINING COMPLETE', '3 years. ready to go home.');
      this.look(V(4, 3, 14), V(8, 1.2, 5), 48);
      return;
    }
    d.visible = false; // in
    const drive = k - 2;
    co.lookAt(c.position);
    if (drive < 1.3) {
      c.position.set(10 + drive * drive * 6, 0.62, 6 - drive * 3); c.rotation.set(0, 2.2, 0);
      this.cue('go', () => a.play('rev'));
      for (const w of this.car.wheels) w.spin.rotation.x += dt * 30;
    } else {
      // over the rock and onto its roof
      const f = ease(drive, 1.3, 2.2);
      const x = 10 + 1.69 * 6 + f * 4;
      c.position.set(x, 0.62 + Math.sin(f * Math.PI) * 2.2 + f * 0.5, 6 - 3.9 - f * 2);
      c.rotation.set(0, 2.2, f * Math.PI);
      this.cue('flip', () => { a.play('crash'); setTimeout(() => a.play('buzz'), 600); });
      if (drive > 2.4) { co.userData.shR.rotation.set(-2.6, 0, -0.5); } // facepalm
    }
    this.rock.position.set(10 + 1.69 * 6 + 0.5, 0.6, 2);
    if (drive < 1.6) this.caption('TRAINING COMPLETE', '3 years. ready to go home.');
    else if (drive < 4.5) this.caption('…', 'it fell over');
    else this.caption('BACK TO DAGESTAN', 'another 3 years', 'huge');
    this.look(drive < 1.2 ? V(4, 4, 18) : V(31, 3.2, 10), drive < 1.2 ? V(18, 1, 2) : V(23, 0.8, 0.5), 50);
  }

  // 104-112: strong enough to flip it back with one hand
  actStrong(t, dt) {
    this.setAct('dag');
    const a = this.app.audio, k = t - STRONG, d = this.driver, co = this.coach, c = this.car.group;
    this.relax(d); this.relax(co);
    d.visible = true;
    const cx = 10 + 1.69 * 6 + 4;
    d.position.set(cx - 2.6, 0, 0); d.lookAt(cx, 0, 0);
    const flip = ease(k, 2, 3);
    c.position.set(cx, mix(1.1, 0.62, flip) + Math.sin(flip * Math.PI) * 1.5, 0);
    c.rotation.set(0, 2.2, Math.PI * (1 - flip));
    d.userData.shR.rotation.x = k < 2 ? -1.2 : k < 3 ? -2.8 : -2.9;
    if (k > 4) { d.userData.shL.rotation.set(-2.6, 0, 0.9); d.userData.shR.rotation.set(-2.6, 0, -0.9); } // the flex
    co.position.set(cx - 4.5, 0, -4); co.lookAt(d.position); this.folded(co);
    if (k > 2.6) this.cue('flip2', () => { a.play('slam'); this.caption('ONE HAND', 'six years well spent', 'huge'); });
    if (k < 2.6) this.caption('YEAR 6', 'finally strong enough');
    if (k > 5.5) this.caption('READY', 'for real this time');
    this.look(V(cx - 6, 2.4, 9), V(cx - 1, 1.2, 0), 46);
  }

  // 112-120: off the mountain and all the way home
  actHome(t, dt) {
    const a = this.app.audio, k = t - HOME, c = this.car.group;
    this.driver.visible = false;
    if (k < 3) {
      this.setAct('dag');
      // up the ramp and launch
      const z = 18 - k * 40, air = Math.max(0, k - 1.24);
      const ramp = z < -8.5 ? -0.3 + ((-8.5 - Math.max(z, -31.5)) / 23) * 6.6 : 0;
      c.position.set(40, 0.62 + ramp + air * 25 + air * air * 12, z);
      c.rotation.set(z < -8.5 ? -0.28 : 0, Math.PI, 0);
      for (const w of this.car.wheels) w.spin.rotation.x += dt * 35;
      this.cue('rev', () => a.play('boost'));
      this.caption('HEADING HOME', 'the long way');
      this.look(c.position.clone().add(V(18, 4, 16)), c.position, 55);
    } else {
      this.setAct('track');
      this.cat.visible = false;
      this.bolts.visible = false;
      for (const r of this.rocks) r.visible = false;
      const u = ease(k, 3, 5.2);
      c.position.set(mix(30, -2, u), mix(140, 0.62, u), mix(220, 120, u) + Math.max(0, k - 5.2) * 24);
      c.rotation.set(0, Math.PI, 0);
      if (k > 5.2) this.cue('touch', () => { a.play('clunk'); for (const x of [-4.5, 0.5]) this.puffs.push(puffBall(this.scene, V(x, 0.5, 118), { glow: false, color: 0xd8d0c0, size: 1.8, life: 0.8 })); });
      for (const w of this.car.wheels) w.spin.rotation.x += dt * (k > 5.2 ? 30 : 0);
      this.caption('BACK IN THE RACE', '6 years for you · 2 minutes for everyone else');
      this.look(V(-12, 4, Math.max(92, c.position.z - 24)), c.position.clone().add(V(0, 1, 4)), 55);
    }
  }
}
