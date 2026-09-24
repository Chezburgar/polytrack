// The 15 second intro: every car on the grid of Island Hopper, each named as
// the camera rolls past; the lights go green on the song's drop; the pack
// launches and flies the first jump in slow motion; the logo slams in over an
// aerial shot; fade to the menu. It opens on a "click to start" card (browsers
// only allow sound after a click) and any key or click skips it.
import * as THREE from 'three';
import { Session } from './session.js';
import { getTrackDef } from '../track/tracks.js';
import { frameAt, gridSlot } from '../track/geometry.js';
import { PRESETS } from '../car/presets.js';
import { BODIES } from '../car/bodies.js';
import { DEFAULT_CAR } from '../car/model.js';
import { h } from '../ui/dom.js';
import { logo } from '../ui/screens/title.js';
import { clamp, smoothstep, lerp } from '../util/math.js';

export const INTRO_LENGTH = 15;
const GREEN = 5.0; // the lights go green here (the music's drop)
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _c = new THREE.Vector3();

export class Intro {
  constructor(app, done) {
    this.app = app;
    this.done = done;
    this.state = 'wait';
    this.t = 0;
    this.cards = [];
    this.el = h('div.intro',
      h('div.in-bars', h('i'), h('i')),
      this.cardEl = h('div.in-card'),
      this.logoEl = h('div.in-logo', logo('big'), h('div.in-tag', 'Low-poly racing. Twenty tracks. Your car, your way.')),
      this.skipEl = h('div.in-skip', 'Press any key to skip'),
      this.fadeEl = h('div.in-fade'),
      this.gateEl = h('div.in-gate',
        logo('big'),
        h('div.in-click', 'Click to start'),
        h('div.in-sub', 'or press any key')));
    app.ui.root.append(this.el);
    this._input = (e) => this.onInput(e);
    // after the audio unlock listener, which runs in the capture phase
    window.addEventListener('pointerdown', this._input);
    window.addEventListener('keydown', this._input);
    this.build();
    this.song = app.audio.prepIntro(); // loads while the card waits for a click
  }

  build() {
    const app = this.app;
    const def = getTrackDef('island-hopper');
    const bots = PRESETS.map((p, i) => ({ id: 'car' + i, name: BODIES[p.car.body]?.name || p.name, custom: { ...DEFAULT_CAR, ...p.car, number: i + 1, showNumber: true }, skill: 0.985 + (i % 3) * 0.005, slot: i }));
    const s = (this.session = new Session(app, { def, mode: 'intro', laps: 0, bots, player: null }));
    s.countdown = GREEN;
    s.camera.setMode('script');
    s.focus = s.entries[0];
    app.session = s;
    this.track = s.track;
    this.cars = s.entries;
    // the grid, back row first, as the camera will pass them
    this.order = this.cars.slice().sort((a, b) => a.race.spawn.s - b.race.spawn.s);
    const kick = this.track.samples.find((sm) => sm.kind === 'K');
    this.kickS = kick ? kick.s : this.track.start.s + 64;
    const gapEnd = this.track.samples.find((sm) => sm.s > this.kickS && sm.kind !== 'K' && sm.kind !== 'J' && sm.road);
    this.landS = gapEnd ? gapEnd.s : this.kickS + 45;
  }

  onInput(e) {
    if (this.state === 'wait') {
      if (e.type === 'keydown' && (e.ctrlKey || e.altKey || e.metaKey)) return;
      this.begin();
    } else if (this.state === 'run' && this.t > 0.6) this.skip();
  }

  begin() {
    this.state = 'cue'; // until the song is actually playing
    this.t = 0;
    this.hold = 0;
    this.gateEl.classList.add('gone');
    this.el.classList.add('running');
    this.app.audio.unlock();
    this.song = this.app.audio.playIntro();
  }

  skip() {
    if (this.state !== 'run') return;
    this.state = 'out';
    this.app.audio.stopIntro(0.6);
    this.fadeEl.classList.add('on', 'quick');
    setTimeout(() => this.finish(), 450);
  }

  finish() {
    if (this.state === 'end') return;
    this.state = 'end';
    window.removeEventListener('pointerdown', this._input);
    window.removeEventListener('keydown', this._input);
    this.done();
    // lift the black once the menu's backdrop race is built and drawn, so its
    // build doesn't stall the fade
    const t0 = performance.now();
    const reveal = () => {
      if (!this.app.session && performance.now() - t0 < 2500) { requestAnimationFrame(reveal); return; }
      requestAnimationFrame(() => {
        this.el.classList.add('leave');
        setTimeout(() => this.el.remove(), 900);
      });
    };
    requestAnimationFrame(reveal);
  }

  update(dt) {
    const s = this.session;
    if (this.state === 'wait' || this.state === 'cue') {
      this.shotGrid(0);
      s._render(0, dt, null);
      // hold the first frame until the song plays (or it's clearly not coming)
      if (this.state === 'cue' && (this.app.audio.introTime() != null || (this.hold += dt) > 2)) this.state = 'run';
      return;
    }
    if (this.state === 'end') return;
    this.t += dt;
    // keep time with the song, and the lights with it: green lands on the drop
    const songT = this.app.audio.introTime();
    if (songT != null) this.t = Math.abs(songT - this.t) > 0.25 ? songT : this.t + (songT - this.t) * 0.1;
    const T = this.t;
    if (T < GREEN) s._cd = GREEN - T;
    // slow motion while the pack is in the air over the first gap
    const lead = this.leader();
    const flying = T > GREEN && this.cars.some((e) => e.car && !e.car.grounded && e.car.airTime > 0.12 && e.prog.s > this.kickS - 5 && e.prog.s < this.landS + 10);
    if (flying) this.slowT = (this.slowT || 0) + dt; // the front of the pack, not every straggler
    s.timeScale = flying && this.slowT < 2.8 ? lerp(s.timeScale, 0.38, 0.2) : lerp(s.timeScale, 1, 0.12);
    s.update(dt, NO_INPUT);
    this.direct(T, dt, lead);
    this.overlays(T);
    if (this.state === 'run' && T >= INTRO_LENGTH - 1.4) {
      this.state = 'out';
      this.app.audio.stopIntro(1.4);
      this.fadeEl.classList.add('on');
      setTimeout(() => this.finish(), 1400);
    }
  }

  leader() {
    let best = this.cars[0];
    for (const e of this.cars) if ((e.prog.s ?? 0) > (best.prog.s ?? 0)) best = e;
    return best;
  }

  // ---- camera ------------------------------------------------------------------
  cam(pos, look, fov = 50) {
    const c = this.app.renderer.camera;
    c.position.copy(pos);
    c.up.set(0, 1, 0);
    c.lookAt(look);
    c.fov = fov;
    c.updateProjectionMatrix();
  }

  at(s, x, y) {
    const f = frameAt(this.track, s);
    return new THREE.Vector3().copy(f.p).addScaledVector(f.l, x).addScaledVector(f.n, y);
  }

  // rolling along the grid, left of the cars, back row to front; it stops short
  // of the gantry's post, easing in to the pole sitter
  shotGrid(u) {
    const st = this.track.start.s;
    const back = gridSlot(this.track, 7).s - 6, front = st - 9.5;
    const s0 = smoothstep(-0.3, 1, 0);
    const s = lerp(back, front, (smoothstep(-0.3, 1, u) - s0) / (1 - s0));
    this.cam(this.at(s, 10.5, lerp(2.1, 1.5, u)), this.at(s + 7, 0, 0.9), 44);
  }

  direct(T, dt, lead) {
    const tr = this.track;
    const st = tr.start.s;
    if (T < GREEN - 0.5) { this.shotGrid(T / (GREEN - 0.5)); return; }
    if (T < GREEN + 0.9) {
      // the start lights head-on, the grid behind them; at green the pack comes
      // at the camera
      const u = (T - (GREEN - 0.5)) / 1.4;
      this.cam(this.at(st + 18 - u * 1.5, 0, 3.2 + u * 0.6), this.at(st, 0, 5.4 - u * 1.4), 50);
      return;
    }
    const pack = this.centroid();
    const dir = frameAt(tr, pack.s).t;
    if (lead.prog.s < this.kickS - 25) {
      // the launch: just behind the last car, the whole pack ahead of it
      const u = clamp((T - GREEN - 0.9) / 1.5, 0, 1);
      _v.copy(pack.tail).addScaledVector(dir, -8 - u * 4).add(_w.set(0, 2.2 + u * 1.2, 0));
      this.cam(_v, _c.copy(pack.p).addScaledVector(dir, 12).add(_w.set(0, 0.6, 0)), 58);
      return;
    }
    if (!this.cars.some((e) => e.prog.s > this.landS + 25) && T < 11.4) {
      // the jump: low beside the gap, panning with the pack as it flies past
      const mid = (this.kickS + this.landS) / 2;
      const want = _c.copy(lead.model.group.position).lerp(pack.p, 0.35);
      if (!this.jumpLook) this.jumpLook = want.clone();
      this.jumpLook.lerp(want, 1 - Math.exp(-dt * 6));
      this.cam(this.at(mid - 4, 15, -0.5), this.jumpLook, 42);
      return;
    }
    // over the top and back as the logo lands
    this.aerial = (this.aerial || 0) + dt;
    const u = clamp(this.aerial / 3, 0, 1);
    _v.copy(pack.p).addScaledVector(dir, -26 - u * 22).add(_w.set(0, 9 + u * 16, 0));
    this.cam(_v, _c.copy(pack.p).addScaledVector(dir, 20), 56);
  }

  centroid() {
    const p = new THREE.Vector3();
    let n = 0, s = 0, tail = null;
    const lead = this.leader().prog.s;
    for (const e of this.cars) {
      if (lead - e.prog.s > 60) continue; // stragglers don't pull the shot back
      p.add(e.model.group.position);
      s += e.prog.s;
      n++;
      if (!tail || e.prog.s < tail.prog.s) tail = e;
    }
    return { p: p.divideScalar(Math.max(1, n)), s: s / Math.max(1, n), tail: (tail || this.cars[0]).model.group.position };
  }

  // ---- words on screen -------------------------------------------------------------
  overlays(T) {
    // one name card per car as the grid rolls by
    const span = GREEN - 0.6;
    const k = Math.floor((T / span) * this.order.length);
    if (T < span && k !== this.cardK && k < this.order.length) {
      this.cardK = k;
      const e = this.order[k];
      const body = BODIES[e.custom.body];
      const card = h('div.in-name', { style: { '--c': e.custom.paint } }, h('b', (body?.name || e.name).toUpperCase()), h('span', body?.blurb || ''));
      this.cardEl.replaceChildren(card);
    }
    if (T >= span && this.cardK !== -1) { this.cardK = -1; this.cardEl.replaceChildren(); }
    if (T > 0.8) this.skipEl.classList.add('on');
    // the logo slams in once the pack has landed
    if (!this.logoShown && (this.aerial > 0.25 || T > 11.8)) { this.logoShown = true; this.logoEl.classList.add('on'); this.app.audio.play('slam'); }
  }

  dispose() {
    this.state = 'end';
    window.removeEventListener('pointerdown', this._input);
    window.removeEventListener('keydown', this._input);
    this.app.audio.stopIntro(0.3);
    this.el.remove();
  }
}

const NO_INPUT = { throttle: 0, brake: 0, steer: 0, handbrake: 0, analog: false, lookBack: false };
