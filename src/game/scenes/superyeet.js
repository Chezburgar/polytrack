// /superyeet: a 60 second film. The cat is back - with rocket fists. One punch
// sends the car past the Moon, Mars, Jupiter, Saturn and Neptune to Pluto. A
// UFO lands; the aliens teach the driver to build a much bigger rocket; they
// build it together; it launches, drops its boosters and flies the car home.
import * as THREE from 'three';
import { buildCar } from '../../car/model.js';
import { makeProp } from '../../render/props.js';
import { mulberry32, smoothstep } from '../../util/math.js';
import { Cutscene, person, walk, cat, wagTail, planet, stars, rocket, terrain, box, ball, tube, textPanel, glowMat, puffBall, alien, ufo, ease, lin, mix, V } from './kit.js';

export const SUPERYEET_LENGTH = 60;
const PUNCH = 6.2, SPACE = 9, PLUTO = 20, UFO = 24, SCHOOL = 32, BUILD = 41, LAUNCH = 50, RETURN = 53.5, HOME = 57;
const SKY = new THREE.Color(0x9fd0f0), SPACE_BG = new THREE.Color(0x02030a);

const lambert = (color, o = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...o });

// the big one: the old rocket, scaled up, with four boosters round it
function superRocket() {
  const core = rocket();
  core.scale.setScalar(1.5);
  const g = new THREE.Group();
  g.add(core);
  const boosters = [];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const b = new THREE.Group();
    const body = tube(1.2, 1.2, 9, k % 2 ? 0xf2f2f2 : 0xe8433a, 12); body.position.y = 4.5; b.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.4, 12), lambert(0x3a3d44)); nose.position.y = 10.2; b.add(nose);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(1, 5, 10, 1, true), glowMat(0xffa040, 3)); flame.rotation.x = Math.PI; flame.position.y = -2.4; flame.visible = false; b.add(flame);
    b.position.set(Math.cos(a) * 5.4, 0, Math.sin(a) * 5.4);
    b.userData = { flame, a };
    g.add(b);
    boosters.push(b);
  }
  g.userData = { core, boosters, parts: [...core.userData.parts, ...boosters] };
  return g;
}

export class SuperYeetScene extends Cutscene {
  constructor(app, victim, opts = {}) {
    super(app, { length: SUPERYEET_LENGTH, ...opts });
    this.name = (victim.name || 'Racer').replace(/\s*\(AI\)$/, '');
    this.rnd = mulberry32(7);
    this.car = buildCar(victim.custom, { shadows: false });
    this.scene.add(this.car.group);
    this.buildTrack();
    this.buildSpace();
    this.buildPluto();
    this.puffs = [];
    this.sparks = [];
    this.sparkMat = glowMat(0xffd070, 3);
    this.cues = new Set();
  }

  cue(n, fn) { if (!this.cues.has(n)) { this.cues.add(n); fn(); } }

  // ---- sets ------------------------------------------------------------------------------
  buildTrack() {
    const g = (this.trackSet = new THREE.Group());
    g.add(terrain(600, 60, [0x6fae45, 0x7cb850, 0x64a03e], 5, 12, (x, z) => smoothstep(9, 30, Math.abs(x + 2)) * smoothstep(12, 26, Math.hypot(x - 13, z - 44))));
    g.add(box(12, 0.3, 700, 0x4b4f59, -2, 0.1, 150));
    for (let z = -150; z < 450; z += 8) g.add(box(0.3, 0.02, 4, 0xf2f2f2, -2, 0.27, z));
    for (const x of [-8.3, 4.3]) for (let z = -150; z < 450; z += 3) g.add(box(0.6, 0.25, 3, (z / 3) % 2 ? 0xe8433a : 0xf5f5f5, x, 0.15, z));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    for (let i = 0; i < 60; i++) {
      const side = i % 2 ? 1 : -1;
      const t = new THREE.Mesh(makeProp(this.rnd() < 0.5 ? 'pine' : 'oak', this.rnd), mat);
      t.position.set(side * (30 + this.rnd() * 140), 0, -100 + this.rnd() * 500);
      t.scale.setScalar(1.2 + this.rnd());
      g.add(t);
    }
    this.cat = cat();
    this.cat.position.set(13, 0, 44);
    this.cat.rotation.y = -Math.PI / 2;
    // rocket fists: a booster strapped to each front paw
    this.fists = [];
    const addFist = (parent, y) => {
      const f = new THREE.Group();
      const body = tube(1.75, 1.75, 3.4, 0xe8433a, 12); body.rotation.x = Math.PI / 2; f.add(body);
      const band = tube(1.8, 1.8, 0.5, 0xf2f2f2, 12); band.rotation.x = Math.PI / 2; f.add(band);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(1.1, 5, 12, 1, true), glowMat(0xffa040, 3));
      flame.rotation.x = -Math.PI / 2; flame.position.z = -4.1; flame.visible = false;
      f.add(flame);
      f.position.y = y;
      f.userData.flame = flame;
      parent.add(f);
      this.fists.push(f);
    };
    addFist(this.cat.userData.paw, -6.5);
    // the other paw: find the left front leg's foot (a ball near x=2.4) and strap one on there too
    const leftFoot = this.cat.children.find((c) => c.geometry?.type === 'IcosahedronGeometry' && Math.abs(c.position.x - 2.4) < 0.01 && c.position.y < 2);
    if (leftFoot) { const holder = new THREE.Group(); holder.position.copy(leftFoot.position).setY(2.5); this.cat.add(holder); addFist(holder, 0); }
    g.add(this.cat);
    this.scene.add(g);
  }

  buildSpace() {
    const g = (this.spaceSet = new THREE.Group());
    g.add(stars(3000, 3500, 9));
    this.moon = planet(50, 'moon', 4);
    this.marsP = planet(90, 'mars', 6);
    this.jupiter = planet(420, 'jupiter', 8);
    this.saturn = planet(330, 'saturn', 10);
    const ring = new THREE.Mesh(new THREE.RingGeometry(420, 640, 64, 1), new THREE.MeshBasicMaterial({ color: 0xe8d8a8, side: THREE.DoubleSide, transparent: true, opacity: 0.7 }));
    ring.rotation.x = Math.PI / 2 - 0.3;
    this.saturn.add(ring);
    this.neptune = planet(200, 'neptune', 12);
    this.pluto = planet(160, 'pluto', 14);
    this.earth = planet(380, 'earth', 2);
    this.worlds = [this.moon, this.marsP, this.jupiter, this.saturn, this.neptune, this.pluto, this.earth];
    for (const w of this.worlds) { w.visible = false; g.add(w); }
    g.visible = false;
    this.scene.add(g);
  }

  buildPluto() {
    const g = (this.plutoSet = new THREE.Group());
    g.add(terrain(900, 60, [0xe8d8c8, 0xd8c0a8, 0xf4ece4, 0xc8a888], 8, 23, (x, z) => smoothstep(16, 55, Math.hypot(x, z))));
    g.add(stars(2000, 3000, 4));
    const sun = ball(6, glowMat(0xfff4d0, 2.2), 900, 500, -1800, 1); g.add(sun); // the Sun, very far away
    for (let i = 0; i < 50; i++) { const r = ball(0.8 + this.rnd() * 2.5, 0xa8886a, (this.rnd() - 0.5) * 300, 0.4, (this.rnd() - 0.5) * 300, 0); r.scale.y = 0.6; g.add(r); }
    this.crater = new THREE.Mesh(new THREE.CircleGeometry(7, 16), lambert(0x8a6a50));
    this.crater.rotation.x = -Math.PI / 2; this.crater.position.y = 0.4; this.crater.visible = false; g.add(this.crater);
    this.astro = person({ suit: 0xf2f2f2, trim: 0xe8433a, astronaut: true }); this.astro.visible = false; g.add(this.astro);
    this.ship = ufo(); this.ship.position.set(-26, 60, -10); g.add(this.ship);
    this.aliens = [0x7ae85a, 0x5ad8a8, 0xa8e85a].map((c) => { const a = alien(c); a.visible = false; g.add(a); return a; });
    // the classroom: a blackboard on legs
    this.board = new THREE.Group();
    const bb = textPanel(['ROCKETS 101', 'more boosters = more go', 'pointy end goes UP'], 9, 5, { bg: '#1f3a2a', fg: '#f4f4e8', sizes: [0.9, 0.62, 0.62] });
    bb.position.y = 4;
    this.board.add(bb, box(9.6, 0.4, 0.3, 0x8a5a2a, 0, 1.4, 0), box(0.3, 1.5, 0.3, 0x8a5a2a, -4.2, 0.7, 0), box(0.3, 1.5, 0.3, 0x8a5a2a, 4.2, 0.7, 0));
    this.board.position.set(-18, 0, -6);
    this.board.rotation.y = 0.5;
    this.board.visible = false;
    g.add(this.board);
    this.big = superRocket();
    this.big.userData.parts.forEach((p) => { p.userData.home = p.position.clone(); p.visible = false; });
    this.big.position.set(12, 0, -4);
    g.add(this.big);
    g.visible = false;
    this.scene.add(g);
  }

  setAct(name) {
    if (this.act === name) return;
    this.act = name;
    const sc = this.scene;
    this.trackSet.visible = name === 'track' || name === 'home';
    this.spaceSet.visible = name === 'space';
    this.plutoSet.visible = name === 'pluto';
    this.sun.intensity = name === 'pluto' ? 1.6 : 2.4;
    if (name === 'track' || name === 'home') { sc.background = SKY.clone(); sc.fog = new THREE.Fog(0xbfe3f7, 150, 700); this.hemi.intensity = 1.25; }
    if (name === 'space') { sc.background = SPACE_BG.clone(); sc.fog = null; this.hemi.intensity = 0.55; }
    if (name === 'pluto') { sc.background = new THREE.Color(0x06060e); sc.fog = new THREE.Fog(0x14121e, 160, 700); this.hemi.intensity = 0.9; }
  }

  spark(parent, p, n = 6) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.3), this.sparkMat);
      m.position.copy(p);
      m.userData.v = V((Math.random() - 0.5) * 7, Math.random() * 6, (Math.random() - 0.5) * 7);
      m.userData.life = 0.35 + Math.random() * 0.3;
      parent.add(m); this.sparks.push(m);
    }
  }

  // ---- the film ------------------------------------------------------------------------------
  play(t, dt) {
    if (t < SPACE) this.actPunch(t, dt);
    else if (t < PLUTO) this.actTrip(t, dt);
    else if (t < UFO) this.actCrash(t, dt);
    else if (t < SCHOOL) this.actAliens(t, dt);
    else if (t < BUILD) this.actSchool(t, dt);
    else if (t < LAUNCH) this.actBuild(t, dt);
    else if (t < RETURN) this.actLaunch(t, dt);
    else if (t < HOME) this.actReturn(t, dt);
    else this.actHome(t, dt);
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const m = this.sparks[i], u = m.userData;
      u.life -= dt; u.v.y -= 9 * dt; m.position.addScaledVector(u.v, dt);
      if (u.life <= 0) { m.parent?.remove(m); m.geometry.dispose(); this.sparks.splice(i, 1); }
    }
    this.puffs = this.puffs.filter((f) => !f(dt));
  }

  // 0-9: the cat, rocket fists, the punch
  actPunch(t, dt) {
    this.setAct('track');
    const a = this.app.audio, c = this.car.group, u = this.cat.userData;
    wagTail(this.cat, t, 0.4);
    const on = t > 3.2;
    for (const f of this.fists) { f.userData.flame.visible = on; f.userData.flame.scale.set(1, (t > PUNCH - 0.4 ? 1.6 : 0.8) + Math.random() * 0.3, 1); }
    if (on) this.cue('ignite', () => { a.play('rocket'); this.caption('ROCKET FISTS', 'engaged'); });
    if (t > 1.2 && t < 3.2) this.cue('back', () => this.caption('THE CAT IS BACK', 'and this time it has upgrades'));
    // wind up, then PUNCH straight down the road at the car
    const wind = ease(t, 3.4, 5.4), hitK = ease(t, PUNCH - 0.25, PUNCH);
    u.paw.rotation.x = -2.2 * wind + 1.2 * hitK;
    u.paw.rotation.z = -0.4 * wind + 1.4 * hitK;
    u.head.rotation.y = t < PUNCH ? 0.4 * (1 - ease(t, 0, 3)) : -0.2;
    if (t < PUNCH) {
      c.position.set(-2, 0.62, Math.min(-10 + 11 * t, 40));
      c.rotation.set(0, 0, 0);
      for (const w of this.car.wheels) w.spin.rotation.x += dt * (t < 4.5 ? 30 : 0);
      if (t < 3.4) this.look(V(-5, 2, c.position.z - 10), V(2, 8, c.position.z + 28), 55);
      else this.look(V(-32, 7, 30), V(4, 11, 42), 52);
    } else {
      const k = t - PUNCH;
      this.cue('punch', () => { a.play('crash'); a.play('yeet'); this.caption('SUPER YEET!!', '', 'huge'); for (let i = 0; i < 8; i++) this.puffs.push(puffBall(this.scene, V(-2 + (Math.random() - 0.5) * 5, 1, 40 + (Math.random() - 0.5) * 5), { color: 0xffa040, size: 3, life: 0.7 })); });
      c.position.set(-2 - 10 * k, 0.62 + 60 * k + 40 * k * k, 40 + 30 * k);
      c.rotation.set(k * 9, k * 4, k * 11);
      this.look(V(c.position.x + 6, c.position.y - 6, c.position.z - 14), c.position, 55);
      // the sky goes black as it leaves the air
      this.scene.background.lerpColors(SKY, SPACE_BG, ease(k, 1.2, 2.8));
      if (k > 1.6) this.caption(`BYE ${this.name.toUpperCase()}`, 'see you in 5.9 billion km');
    }
  }

  // 9-20: past the planets, one by one
  actTrip(t, dt) {
    this.setAct('space');
    const c = this.car.group;
    c.position.set(0, 0, 0);
    c.rotation.set(t * 2.2, t * 1.4, t * 2.8);
    // each world slides past on the left, in turn
    const legs = [[this.moon, 9, 10.8, 'THE MOON'], [this.marsP, 10.8, 12.4, 'MARS'], [this.jupiter, 12.4, 14.4, 'JUPITER'], [this.saturn, 14.4, 16.4, 'SATURN'], [this.neptune, 16.4, 18.2, 'NEPTUNE']];
    for (const [w, a0, a1, label] of legs) {
      w.visible = t > a0 - 0.2 && t < a1 + 0.2;
      if (!w.visible) continue;
      const k = (t - a0) / (a1 - a0);
      const r = w.geometry.parameters.radius;
      w.position.set(-r * 1.4 - 30, -r * 0.3, mix(r * 4 + 500, r * 1.4, k)); // looming up and off the left of the frame
      w.rotation.y = t * 0.2;
      if (k > 0.2 && k < 0.9) this.caption(label, `${Math.round(mix(5.9, 0.1, lin(t, SPACE, PLUTO)) * 1000) / 1000} billion km to Pluto`);
    }
    this.pluto.visible = t > 18;
    if (this.pluto.visible) { this.pluto.position.set(40, -20, mix(1600, 320, ease(t, 18, PLUTO))); this.pluto.rotation.y = t * 0.1; this.caption('PLUTO', 'you have arrived. sort of.'); }
    this.cue('trip', () => this.app.audio.play('whoosh'));
    this.look(V(-4 + Math.sin(t * 0.6) * 2, 4, -14), V(-6, -1, 30), 58);
  }

  // 20-24: crash landing on Pluto
  actCrash(t, dt) {
    this.setAct('pluto');
    const a = this.app.audio, c = this.car.group, k = t - PLUTO;
    if (k < 1.1) {
      const u = k / 1.1;
      c.position.set(mix(-110, 0, u), mix(150, 1.1, u * u), mix(-70, 0, u));
      c.rotation.set(t * 4, t * 2, t * 5);
      if (Math.random() < 0.9) this.puffs.push(puffBall(this.scene, c.position.clone().add(V(-4, 5, -3)), { color: 0x9ac8ff, size: 2.2, life: 0.4, rise: 0 }));
      this.look(V(c.position.x + 22, c.position.y - 6, c.position.z + 26), c.position, 50);
      this.caption('', '');
    } else {
      this.cue('land', () => { a.play('crash'); this.crater.visible = true; for (let i = 0; i < 10; i++) { const ang = (i / 10) * Math.PI * 2; this.puffs.push(puffBall(this.scene, V(Math.cos(ang) * 9, 0.4, Math.sin(ang) * 9), { glow: false, color: 0xe8d8c8, size: 1.6, life: 1, rise: 3 })); } });
      c.position.set(0, 1.1, 0);
      c.rotation.set(0, 0.6, Math.PI);
      this.look(V(16, 6, 18), V(0, 1, 0), 45);
      this.caption('WELCOME TO PLUTO', "(it's still a planet to us)");
    }
  }

  // 24-32: a UFO lands and the aliens say hello
  actAliens(t, dt) {
    this.setAct('pluto');
    const a = this.app.audio, k = t - UFO, sh = this.ship, u = sh.userData, c = this.car.group;
    // the car's been flipped back up by the driver meanwhile
    c.position.set(0, 0.62, 0); c.rotation.set(0, 0.6, 0);
    this.astro.visible = true;
    this.astro.position.set(2.8, 0, 2.4);
    this.astro.lookAt(sh.position.x, 0, sh.position.z);
    // the UFO drops in
    const land = ease(k, 0, 2.6);
    sh.position.set(-26, mix(60, 3.2, land), -10);
    sh.rotation.y = (1 - land) * 14; // spinning down, settling with the door to the car
    u.lights.forEach((l, i) => { l.visible = Math.floor(t * 8 + i) % 2 === 0; });
    u.beam.visible = k > 1.4 && k < 3.6;
    this.cue('ufo', () => a.play('ufo'));
    if (k > 2.6) u.ramp.visible = true;
    // three aliens come down the ramp and wave
    this.aliens.forEach((al, i) => {
      const go = ease(k, 3.2 + i * 0.5, 5.2 + i * 0.5);
      al.visible = k > 3.2 + i * 0.5;
      al.position.set(mix(-26, -9 + i * 3.2, go), 0, mix(1.5, -1 + (i - 1) * 1.8, go));
      al.lookAt(0, 0, 0);
      walk(al, t * 9, go > 0 && go < 1 ? 0.7 : 0);
      if (go >= 1) al.userData.shR.rotation.x = -2.6 + Math.sin(t * 8 + i) * 0.5; // waving
    });
    if (k > 3.4) this.cue('blip', () => a.play('alien'));
    this.caption(k < 3 ? 'INCOMING' : 'THEY COME IN PEACE', k < 5.5 ? '' : '…and they have seen your driving');
    // wide for the landing, then in close on the welcome party
    const cu = ease(k, 4.2, 5.6);
    this.look(V(mix(14, 5, cu), mix(7, 2.6, cu), mix(20, 9, cu)), V(mix(-12, -6, cu), mix(3, 1.9, cu), mix(-4, -1, cu)), 50);
  }

  // 32-41: Alien Rocket Academy
  actSchool(t, dt) {
    this.setAct('pluto');
    const a = this.app.audio, k = t - SCHOOL;
    const b = this.board;
    b.visible = true;
    this.ship.userData.lights.forEach((l, i) => { l.visible = Math.floor(t * 4 + i) % 2 === 0; });
    // the teacher points at the board; the others and the driver listen
    const [teacher, ...rest] = this.aliens;
    teacher.position.set(-14.5, 0, -2.5);
    teacher.lookAt(0, 0, 4);
    teacher.userData.shR.rotation.x = -1.8 + Math.sin(t * 3) * 0.4;
    walk(teacher, 0, 0);
    rest.forEach((al, i) => { al.position.set(-15 + i * 2.6, 0, 3); al.lookAt(-18, 0, -6); walk(al, 0, 0); al.userData.shR.rotation.x = 0; });
    this.astro.position.set(-19.5, 0, 3.6);
    this.astro.lookAt(-18, 0, -6);
    walk(this.astro, 0, 0);
    this.astro.userData.shR.rotation.x = -0.9 + Math.sin(t * 12) * 0.08; // taking notes
    if (k < 1.5) this.cue('bell', () => a.play('ding'));
    this.caption('ALIEN ROCKET ACADEMY', k < 4.5 ? 'lesson 1: more boosters' : 'lesson 2: pointy end goes UP');
    if (k > 4.5) this.cue('lesson2', () => a.play('alien'));
    this.look(V(-10 + Math.sin(k * 0.3) * 2, 4.5, 12), V(-17, 3, -4), 48);
  }

  // 41-50: building the super rocket round the car, with help
  actBuild(t, dt) {
    this.setAct('pluto');
    const a = this.app.audio, k = t - BUILD, big = this.big, parts = big.userData.parts;
    this.board.visible = false;
    const c = this.car.group;
    c.position.set(12, 0.62, -4); c.rotation.set(0, 0.6, 0); // wheeled into the middle
    const B1 = 8;
    parts.forEach((p, i) => {
      const at = (i / parts.length) * B1;
      p.visible = k > at;
      const f = ease(k, at, at + 0.4);
      p.position.copy(p.userData.home).setY(p.userData.home.y + (1 - f) * 22);
      if (k > at + 0.4) this.cue('part' + i, () => { a.play('clank'); this.spark(this.plutoSet, p.getWorldPosition(V()).add(V(0, 1, 3)), 10); });
    });
    // everyone hammering
    [...this.aliens, this.astro].forEach((w, i) => {
      const ang = (i / 4) * Math.PI * 2 + 0.4;
      w.visible = true;
      w.position.set(big.position.x + Math.cos(ang) * 8.5, 0, big.position.z + Math.sin(ang) * 8.5);
      w.lookAt(big.position.x, 0, big.position.z);
      walk(w, 0, 0);
      w.userData.shR.rotation.x = -1.6 + Math.abs(Math.sin(t * 8 + i)) * 1.4;
      if (Math.random() < dt * 3) this.spark(this.plutoSet, V(w.position.x * 0.8 + big.position.x * 0.2, 2.5, w.position.z * 0.8 + big.position.z * 0.2), 3);
    });
    const prog = Math.min(1, k / B1);
    this.progress(prog, `BUILDING SUPER ROCKET ${Math.round(prog * 100)}%`);
    this.caption(k < 2.5 ? 'TEAMWORK' : k < 5.5 ? '12 PLUTO DAYS LATER…' : 'THE SUPER ROCKET', k < 2.5 ? 'the aliens brought tools' : k < 5.5 ? '(that is 77 earth days)' : 'four boosters. zero safety checks.');
    const orb = 0.4 + k * 0.1;
    this.look(V(big.position.x + Math.sin(orb) * 34, 11 + k * 0.5, big.position.z + Math.cos(orb) * 34), V(big.position.x, 8, big.position.z), 50);
  }

  // 50-53.5: lift-off, boosters away
  actLaunch(t, dt) {
    this.setAct('pluto');
    this.progress(null);
    const a = this.app.audio, k = t - LAUNCH, big = this.big, core = big.userData.core;
    this.car.group.visible = false; // aboard
    this.astro.visible = false;
    const lift = Math.max(0, k - 1.1);
    big.position.y = 0.5 * 12 * lift * lift;
    core.userData.flame.visible = k > 0.9;
    core.userData.flame.scale.set(1, 0.8 + Math.random() * 0.4, 1);
    for (const b of big.userData.boosters) b.userData.flame.visible = k > 0.9 && k < 2.4;
    // the boosters fall away
    if (k > 2.4) big.userData.boosters.forEach((b) => { const s = k - 2.4; b.position.set(Math.cos(b.userData.a) * (5.4 + s * 6), -s * s * 6, Math.sin(b.userData.a) * (5.4 + s * 6)); b.rotation.z = s * 0.8; });
    if (k > 2.4) this.cue('sep', () => a.play('clunk'));
    this.caption(k < 0.35 ? '3' : k < 0.7 ? '2' : k < 1.05 ? '1' : k < 2.4 ? 'LIFT OFF!' : 'BOOSTERS AWAY', k > 2.4 ? 'bye, aliens!' : '', k < 2.4 ? 'huge' : '');
    if (k > 0.9) { this.cue('rocket', () => a.play('rocket')); if (Math.random() < 0.9) this.puffs.push(puffBall(this.scene, V(big.position.x + (Math.random() - 0.5) * 12, Math.max(0.5, big.position.y - 2), big.position.z + (Math.random() - 0.5) * 12), { glow: false, color: 0xe8e0d8, size: 5, life: 1.4, rise: 1 })); }
    this.aliens.forEach((al, i) => { al.position.set(-6 + i * 3, 0, 10); al.lookAt(big.position.x, 0, big.position.z); walk(al, 0, 0); al.userData.shR.rotation.x = -2.6 + Math.sin(t * 9 + i) * 0.5; });
    const shake = k > 0.9 ? (Math.random() - 0.5) * 0.6 : 0;
    this.look(V(-10 + shake, 4 + shake, 34), V(big.position.x, 8 + big.position.y * 0.8, big.position.z), 55);
  }

  // 53.5-57: 5.9 billion km home in three and a half seconds
  actReturn(t, dt) {
    this.setAct('space');
    const big = this.big, k = t - RETURN, u = k / (HOME - RETURN);
    if (big.parent !== this.spaceSet) {
      this.spaceSet.add(big);
      for (const f of this.puffs) f(99); // the launch smoke stays on Pluto
      this.puffs = [];
      for (const b of big.userData.boosters) b.visible = false;
    }
    this.car.group.visible = false;
    big.position.set(0, 0, 0);
    big.rotation.set(Math.PI / 2, t * 0.8, 0); // nose ahead (+z), rolling
    const fl = big.userData.core.userData.flame;
    fl.visible = true; fl.scale.set(1, 1.2 + Math.random() * 0.4, 1);
    // the planets flash past the other way, Earth growing ahead
    for (const w of this.worlds) w.visible = false;
    const flyby = [[this.neptune, 0, 0.9, 1], [this.saturn, 0.7, 1.7, -1], [this.jupiter, 1.4, 2.4, 1], [this.marsP, 2.1, 2.9, -1]];
    for (const [w, a0, a1, side] of flyby) {
      if (k < a0 || k > a1) continue;
      const r = w.geometry.parameters.radius;
      w.visible = true;
      w.position.set(side * (r * 1.3 + 40), -r * 0.2, mix(r * 3 + 600, -r * 3 - 400, (k - a0) / (a1 - a0)));
    }
    this.earth.visible = true;
    this.earth.position.set(-60, -40, mix(4200, 700, ease(u, 0, 1)));
    this.earth.rotation.y = t * 0.1;
    this.caption('HEADING HOME', `${(mix(5.9, 0, u)).toFixed(1)} billion km to go · super rocket speed`);
    this.cue('warp', () => this.app.audio.play('whoosh'));
    this.look(V(24, 7, -2), V(-4, -2, 26), 55);
  }

  // 57-60: down beside the track, the car rolls out, back in the race
  actHome(t, dt) {
    this.setAct('home');
    const a = this.app.audio, k = t - HOME, c = this.car.group, big = this.big;
    if (big.parent !== this.trackSet) this.trackSet.add(big);
    this.cat.visible = true;
    wagTail(this.cat, t, 0.15);
    this.cat.userData.head.rotation.y = -0.6; // it looks a little nervous
    for (const f of this.fists) f.userData.flame.visible = false;
    const u = ease(k, 0, 1.1);
    big.rotation.set(0, 0, 0);
    big.position.set(14, mix(120, 0, u), 92);
    const fl = big.userData.core.userData.flame;
    fl.visible = k < 1.15; fl.scale.set(1, 0.6 + Math.random() * 0.3, 1);
    if (k > 1.1) this.cue('land', () => { a.play('clunk'); for (let i = 0; i < 6; i++) this.puffs.push(puffBall(this.scene, V(14 + (Math.random() - 0.5) * 10, 0.8, 92 + (Math.random() - 0.5) * 10), { glow: false, color: 0xd8d0c0, size: 3, life: 0.9 })); });
    const roll = Math.max(0, k - 1.25);
    c.visible = k > 1.15;
    c.position.set(mix(14, -2, ease(roll, 0, 0.6)), 0.62, 92 + roll * roll * 12 + roll * 5);
    c.rotation.set(0, -0.5 * (1 - ease(roll, 0, 0.6)), 0);
    for (const w of this.car.wheels) w.spin.rotation.x += dt * (roll > 0 ? 30 : 0);
    this.caption('BACK IN THE RACE', '…60 seconds later');
    this.look(V(-12, 4, 70), V(5, 4 + (1 - u) * 26, 94), 55);
  }
}
