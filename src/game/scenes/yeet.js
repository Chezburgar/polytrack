// /yeet: a 30 second film. A giant cat by the track swats the victim's car into
// the sky; it tumbles through space to Mars and crash-lands; the driver climbs
// out and builds a rocket round the car; it launches, flies home and drops the
// car back on the track.
import * as THREE from 'three';
import { buildCar } from '../../car/model.js';
import { makeProp } from '../../render/props.js';
import { mulberry32, smoothstep } from '../../util/math.js';
import { Cutscene, person, walk, cat, wagTail, planet, stars, rocket, terrain, box, ball, glowMat, puffBall, ease, lin, mix, V } from './kit.js';

export const YEET_LENGTH = 30;
// the acts
const SPACE = 7, MARS = 11.5, BUILD = 14.5, LAUNCH = 24, HOME = 28;

export class YeetScene extends Cutscene {
  constructor(app, victim, opts = {}) {
    super(app, { length: YEET_LENGTH, ...opts });
    this.name = (victim.name || 'Racer').replace(/\s*\(AI\)$/, '');
    this.rnd = mulberry32(99);
    const sc = this.scene;
    this.car = buildCar(victim.custom, { shadows: false });
    sc.add(this.car.group);
    this.buildTrack();
    this.buildSpace();
    this.buildMars();
    this.puffs = [];
    this.cues = new Set();
    this.sparkMat = glowMat(0xffd070, 3);
    this.sparks = [];
  }

  cue(name, fn) { if (!this.cues.has(name)) { this.cues.add(name); fn(); } }

  // ---- sets -------------------------------------------------------------------------------
  buildTrack() {
    const g = (this.trackSet = new THREE.Group());
    g.add(terrain(600, 60, [0x6fae45, 0x7cb850, 0x64a03e], 5, 11, (x, z) => smoothstep(9, 30, Math.abs(x + 2)) * smoothstep(12, 26, Math.hypot(x - 13, z - 44))));
    const road = box(12, 0.3, 700, 0x4b4f59, -2, 0.1, 150);
    g.add(road);
    for (let z = -150; z < 450; z += 8) g.add(box(0.3, 0.02, 4, 0xf2f2f2, -2, 0.27, z));
    for (const x of [-8.3, 4.3]) for (let z = -150; z < 450; z += 3) g.add(box(0.6, 0.25, 3, (z / 3) % 2 ? 0xe8433a : 0xf5f5f5, x, 0.15, z));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    for (let i = 0; i < 60; i++) {
      const side = i % 2 ? 1 : -1, x = side * (30 + this.rnd() * 140), z = -100 + this.rnd() * 500;
      const tree = new THREE.Mesh(makeProp(this.rnd() < 0.5 ? 'pine' : 'oak', this.rnd), mat);
      tree.position.set(x, 0, z);
      tree.scale.setScalar(1.2 + this.rnd());
      g.add(tree);
    }
    this.cat = cat();
    this.cat.position.set(13, 0, 44);
    this.cat.rotation.y = -Math.PI / 2; // facing the road
    g.add(this.cat);
    this.scene.add(g);
  }

  buildSpace() {
    const g = (this.spaceSet = new THREE.Group());
    g.add(stars(2600, 3500, 5));
    this.earth = planet(380, 'earth', 2);
    this.moon = planet(60, 'moon', 4);
    this.mars = planet(260, 'mars', 6);
    g.add(this.earth, this.moon, this.mars);
    g.visible = false;
    this.scene.add(g);
  }

  buildMars() {
    const g = (this.marsSet = new THREE.Group());
    g.add(terrain(900, 60, [0xc0582e, 0xb04e28, 0xd06a3a, 0xa84a26], 9, 21, (x, z) => smoothstep(14, 45, Math.hypot(x, z))));
    for (let i = 0; i < 70; i++) {
      const r = ball(0.8 + this.rnd() * 3, 0x7a3220, (this.rnd() - 0.5) * 300, 0.3, (this.rnd() - 0.5) * 300, 0);
      r.scale.y = 0.6;
      g.add(r);
    }
    this.crater = new THREE.Mesh(new THREE.CircleGeometry(7, 16), new THREE.MeshLambertMaterial({ color: 0x6a2a18 }));
    this.crater.rotation.x = -Math.PI / 2; this.crater.position.y = 0.4; this.crater.visible = false;
    g.add(this.crater);
    this.astro = person({ suit: 0xf2f2f2, trim: 0xe8433a, astronaut: true });
    this.astro.visible = false;
    g.add(this.astro);
    this.ship = rocket();
    this.ship.userData.parts.forEach((p) => { p.userData.home = p.position.clone(); p.visible = false; });
    g.add(this.ship);
    // scaffolding: a few poles and a deck
    this.scaffold = new THREE.Group();
    for (const [x, z] of [[-4.5, -4.5], [4.5, -4.5], [-4.5, 4.5], [4.5, 4.5]]) this.scaffold.add(box(0.2, 11, 0.2, 0x9a9ea6, x, 5.5, z));
    for (const y of [3.5, 7]) this.scaffold.add(box(9.2, 0.15, 0.4, 0x9a9ea6, 0, y, -4.5), box(9.2, 0.15, 0.4, 0x9a9ea6, 0, y, 4.5));
    this.scaffold.visible = false;
    g.add(this.scaffold);
    g.visible = false;
    this.scene.add(g);
  }

  setAct(name) {
    if (this.act === name) return;
    this.act = name;
    const sc = this.scene;
    this.trackSet.visible = name === 'track' || name === 'home';
    this.spaceSet.visible = name === 'space';
    this.marsSet.visible = name === 'mars';
    if (name === 'track' || name === 'home') { sc.background = new THREE.Color(0x9fd0f0); sc.fog = new THREE.Fog(0xbfe3f7, 150, 700); this.hemi.intensity = 1.25; }
    if (name === 'space') { sc.background = new THREE.Color(0x02030a); sc.fog = null; this.hemi.intensity = 0.5; }
    if (name === 'mars') { sc.background = new THREE.Color(0xd8a070); sc.fog = new THREE.Fog(0xd89a6a, 90, 520); this.hemi.intensity = 1.1; }
  }

  sparkAt(p, n = 6) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.3), this.sparkMat);
      m.position.copy(p);
      m.userData.v = V((Math.random() - 0.5) * 7, Math.random() * 6, (Math.random() - 0.5) * 7);
      m.userData.life = 0.35 + Math.random() * 0.3;
      this.marsSet.add(m);
      this.sparks.push(m);
    }
  }

  // ---- the film ---------------------------------------------------------------------------
  play(t, dt) {
    if (t < SPACE) this.actTrack(t, dt);
    else if (t < MARS) this.actSpace(t, dt);
    else if (t < BUILD) this.actCrash(t, dt);
    else if (t < LAUNCH) this.actBuild(t, dt);
    else if (t < HOME) this.actLaunch(t, dt);
    else this.actHome(t, dt);
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const m = this.sparks[i], u = m.userData;
      u.life -= dt; u.v.y -= 9 * dt; m.position.addScaledVector(u.v, dt);
      if (u.life <= 0) { m.parent?.remove(m); m.geometry.dispose(); this.sparks.splice(i, 1); }
    }
    this.puffs = this.puffs.filter((f) => !f(dt));
  }

  // 0-7: down the track, past a very big cat, SWAT
  actTrack(t, dt) {
    this.setAct('track');
    const a = this.app.audio, c = this.car.group, cat = this.cat, u = cat.userData;
    wagTail(cat, t, 0.35);
    const HIT = 4;
    // the cat watches the car come; eyes follow it
    const carZ = Math.min(-8 + 12 * t, 40);
    u.head.rotation.y = t < HIT ? mix(0.7, 0, ease(t, 0, HIT)) : -0.2;
    u.head.rotation.x = t > 4.4 ? -0.45 * ease(t, 4.4, 5.4) : 0; // looking up after it
    // the paw: wind up, then swat across the road
    const up = ease(t, 2.6, 3.5), swat = ease(t, 3.75, 4.05);
    u.paw.rotation.x = -2.1 * up + 0.9 * swat;
    u.paw.rotation.z = -0.6 * up + 1.3 * swat;
    if (t < HIT) {
      c.position.set(-2, 0.62, carZ);
      c.rotation.set(0, 0, 0);
      for (const w of this.car.wheels) w.spin.rotation.x += dt * 30;
      if (t < 0.1) this.cue('start', () => this.caption('', ''));
      if (t > 1.3) this.cue('huh', () => this.caption('…', `is that a cat?`));
      if (t > 2.6) this.cue('meow', () => { a.play('meow'); this.caption('', ''); });
      // low behind the car, then side-on as it reaches the cat
      if (t < 2.4) this.look(V(-4.5, 1.8, carZ - 9), V(0, 4, carZ + 25), 55);
      else this.look(V(-30, 6, 28), V(4, 10, 42), 50);
    } else {
      // launched: up, away over the trees, tumbling
      const k = t - HIT;
      this.cue('yeet', () => { a.play('yeet'); this.caption('YEET!', '', 'huge'); for (let i = 0; i < 6; i++) this.puffs.push(puffBall(this.scene, V(-2 + (Math.random() - 0.5) * 4, 1, 40 + (Math.random() - 0.5) * 4), { glow: false, color: 0xd8d0c0, size: 3, life: 1.2 })); });
      c.position.set(-2 - 18 * k, 0.62 + 34 * k + 20 * k * k, 40 + 22 * k);
      c.rotation.set(k * 7, k * 3, k * 9);
      const cp = c.position;
      // chase it up: behind and below, close enough to see it tumble
      this.look(V(cp.x + 6, cp.y - 5, cp.z - 12), cp, 55);
      if (k > 1.8) this.cue('bye', () => this.caption(`BYE ${this.name.toUpperCase()}`, ''));
    }
  }

  // 7-11.5: out through space, past the Moon, to Mars
  actSpace(t, dt) {
    this.setAct('space');
    const k = (t - SPACE) / (MARS - SPACE);
    const c = this.car.group;
    c.position.set(0, 0, 0);
    c.rotation.set(t * 2.1, t * 1.3, t * 2.7);
    this.earth.position.set(-300 - k * 400, -520 - k * 300, -700 - k * 900);
    this.earth.rotation.y = t * 0.1;
    this.moon.position.set(mix(260, -420, k), mix(60, -40, k), mix(600, -900, k));
    this.mars.position.set(40, -30, mix(2400, 420, ease(k, 0, 1))); // growing ahead, in shot
    this.mars.rotation.y = t * 0.05;
    const km = Math.round(mix(225000000, 0, ease(k, 0, 1)));
    this.caption('NEXT STOP: MARS', `${km.toLocaleString('en-US')} km to go`);
    this.cue('space', () => this.app.audio.play('whoosh'));
    // behind the car, looking past it at Mars
    this.look(V(-3 + Math.sin(t * 0.7) * 2, 3.5, -12), V(4, -2, 30), 55);
  }

  // 11.5-14.5: burning in and crash-landing, upside down
  actCrash(t, dt) {
    this.setAct('mars');
    const a = this.app.audio, c = this.car.group, k = t - MARS;
    const LAND = 1.1;
    if (k < LAND) {
      const u = k / LAND;
      c.position.set(mix(-120, 0, u), mix(160, 1.2, u * u), mix(-80, 0, u));
      c.rotation.set(t * 4, t * 2, t * 5);
      // a fiery trail, behind the car (away from the camera)
      const back = V(-120, 160, -80).sub(V(0, 1.2, 0)).normalize();
      if (Math.random() < 0.9) this.puffs.push(puffBall(this.scene, c.position.clone().addScaledVector(back, 4), { color: 0xff7a2a, size: 2.4, life: 0.45, rise: 0 }));
      this.look(V(c.position.x + 22, c.position.y - 6, c.position.z + 26), c.position, 50);
      this.caption('INCOMING', '');
    } else {
      this.cue('crash', () => {
        a.play('crash');
        this.crater.visible = true;
        for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; this.puffs.push(puffBall(this.scene, V(Math.cos(a) * 9, 0.4, Math.sin(a) * 9), { glow: false, color: 0xc88a60, size: 1.4 + Math.random(), life: 0.9, rise: 3 })); }
      });
      c.position.set(0, 1.1, 0);
      c.rotation.set(0, 0.6, Math.PI); // on its roof
      const u = k - LAND;
      this.look(V(16 - u * 2, 6 + u, 18 - u * 2), V(0, 1, 0), 45);
      if (u > 0.5) this.caption('WELCOME TO MARS', 'population: you');
    }
  }

  // 14.5-24: climb out, flip it, build a rocket round it
  actBuild(t, dt) {
    this.setAct('mars');
    const a = this.app.audio, c = this.car.group, k = t - BUILD;
    const astro = this.astro, sh = this.ship;
    // the driver climbs out and rolls the car back onto its wheels
    astro.visible = true;
    const flip = ease(k, 1.2, 2.2);
    c.position.set(0, mix(1.1, 0.62, flip), 0);
    c.rotation.set(0, 0.6, Math.PI * (1 - flip));
    if (k < 1.2) { astro.position.set(mix(1, 3.6, ease(k, 0, 1.2)), 0, mix(0, 1.5, ease(k, 0, 1.2))); astro.lookAt(0, 0, 0); walk(astro, t * 10, 0.6); }
    else if (k < 2.2) { astro.position.set(3.2, 0, 1.2); astro.lookAt(0, 0, 0); astro.userData.shL.rotation.x = astro.userData.shR.rotation.x = -1.4; walk(astro, 0, 0); }
    if (k > 1.2) this.cue('push', () => a.play('clunk'));
    // then the build: parts drop in, he hammers them home
    const B0 = 2.6, B1 = 8.9;
    const parts = sh.userData.parts;
    sh.position.set(0, 0, 0);
    this.scaffold.visible = k > B0 - 0.3;
    parts.forEach((p, i) => {
      const at = B0 + (i / parts.length) * (B1 - B0);
      p.visible = k > at;
      const f = ease(k, at, at + 0.35);
      p.position.copy(p.userData.home).setY(p.userData.home.y + (1 - f) * 18);
      if (k > at + 0.35) this.cue('part' + i, () => { a.play('clank'); this.sparkAt(V(p.userData.home.x, p.userData.home.y, p.userData.home.z + 2.5), 10); });
    });
    if (k > B0) {
      // hammering on the scaffold
      const lvl = Math.min(2, Math.floor(((k - B0) / (B1 - B0)) * 3));
      astro.position.set(3.6, [0, 3.6, 7.1][lvl], 3.6);
      astro.lookAt(0, astro.position.y, 0);
      astro.userData.shR.rotation.x = -1.6 + Math.abs(Math.sin(t * 8)) * 1.4;
      astro.userData.shL.rotation.x = -0.4;
      walk(astro, 0, 0);
      if (Math.random() < dt * 5) this.sparkAt(V(2.8, astro.position.y + 1.2, 2.8), 3);
    }
    const prog = Math.max(0, Math.min(1, (k - B0) / (B1 - B0)));
    this.progress(k > B0 - 0.5 ? prog : null, `BUILDING SHIP ${Math.round(prog * 100)}%`);
    if (k < 1.2) this.caption('', '');
    else if (k < B0 + 1.4) this.caption('BUILD A SHIP', 'you can fix this');
    else if (k < B0 + 4) this.caption('3 HOURS LATER…', '');
    else if (k < B1) this.caption('9 HOURS LATER…', '');
    else this.caption('DONE!', 'probably safe');
    const orb = 0.6 + k * 0.12;
    this.look(V(Math.sin(orb) * 20, 7 + k * 0.4, Math.cos(orb) * 20), V(0, 3.5, 0), 50);
  }

  // 24-28: countdown, lift-off, and the long way home
  actLaunch(t, dt) {
    const a = this.app.audio, k = t - LAUNCH, sh = this.ship;
    this.progress(null);
    const c = this.car.group;
    if (k < 2.3) {
      this.setAct('mars');
      this.astro.visible = false; // aboard
      this.scaffold.visible = k < 1.2;
      const lift = Math.max(0, k - 1.2);
      sh.position.set(0, 0.5 * 14 * lift * lift, 0);
      c.position.set(0, 0.62 + sh.position.y, 0);
      c.rotation.set(0, 0.6, 0);
      sh.userData.flame.visible = k > 1.0;
      sh.userData.flame.scale.set(1, 0.8 + Math.random() * 0.4, 1);
      if (k < 0.4) this.caption('3', '', 'huge');
      else if (k < 0.8) this.caption('2', '', 'huge');
      else if (k < 1.2) this.caption('1', '', 'huge');
      else this.caption('LIFT OFF!', '', 'huge');
      if (k > 1.0) {
        this.cue('rocket', () => a.play('rocket'));
        if (Math.random() < 0.9) this.puffs.push(puffBall(this.scene, V((Math.random() - 0.5) * 6, sh.position.y - 1, (Math.random() - 0.5) * 6), { glow: false, color: 0xe0d0c0, size: 4, life: 1.4, rise: 1 }));
      }
      const shake = k > 1.0 ? (Math.random() - 0.5) * 0.5 : 0;
      this.look(V(24 + shake, 3 + shake, 18), V(0, 5 + sh.position.y * 0.8, 0), 50);
    } else {
      // space: past Mars, Earth ahead
      this.setAct('space');
      const u = (k - 2.3) / (HOME - LAUNCH - 2.3);
      if (sh.parent !== this.spaceSet) {
        this.spaceSet.add(sh);
        // the launch smoke stays on Mars
        for (const f of this.puffs) f(99);
        this.puffs = [];
      }
      sh.position.set(0, 0, 0);
      sh.rotation.set(Math.PI / 2, 0, 0); // nose ahead (+z)
      sh.userData.flame.visible = true;
      this.scaffold.visible = false;
      c.visible = false; // inside
      // Mars far behind, Earth growing ahead; the camera off to the side, looking forward
      this.mars.position.set(-500, -200, mix(-900, -2400, u));
      this.earth.position.set(-120, -60, mix(2600, 900, u));
      this.moon.position.set(300, 150, 2000);
      sh.rotation.y = t * 0.6; // a roll about its own length (local y, inside the pitch)
      sh.userData.flame.scale.set(0.7, 0.75 + Math.random() * 0.2, 0.7);
      this.look(V(12, 4, -8), V(0, 0, 12), 52); // the rocket right of frame, Earth left
      this.caption('HEADING HOME', 'traffic permitting');
    }
  }

  // 28-30: back to the track
  actHome(t, dt) {
    this.setAct('home');
    const a = this.app.audio, k = t - HOME, c = this.car.group, sh = this.ship;
    sh.parent !== this.trackSet && this.trackSet.add(sh);
    this.cat.visible = false; // it wandered off
    c.visible = true;
    // the ship comes down on its flame beside the road; the car rolls out and away
    const u = ease(k, 0, 1);
    sh.rotation.set(0, 0, 0);
    sh.position.set(8, mix(90, 0, u), 60);
    sh.userData.flame.visible = k < 1.05;
    sh.userData.flame.scale.set(1, 0.6 + Math.random() * 0.3, 1);
    const roll = Math.max(0, k - 1.15);
    c.position.set(mix(8, -2, ease(roll, 0, 0.5)), 0.62, 60 + roll * roll * 12 + roll * 4);
    c.rotation.set(0, -0.4 * (1 - ease(roll, 0, 0.6)), 0);
    c.visible = k > 1.05;
    if (k > 1.05) this.cue('land', () => { a.play('clunk'); for (let i = 0; i < 6; i++) this.puffs.push(puffBall(this.scene, V(8 + (Math.random() - 0.5) * 8, 0.8, 60 + (Math.random() - 0.5) * 8), { glow: false, color: 0xd8d0c0, size: 2.5, life: 0.9 })); });
    for (const w of this.car.wheels) w.spin.rotation.x += dt * (roll > 0 ? 30 : 0);
    this.caption('BACK IN THE RACE', '…30 seconds later');
    this.look(V(-10, 3, 44), V(3, 3 + (1 - u) * 20, 62), 52);
  }
}
