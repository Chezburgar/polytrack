// The pre-race intro: 30 seconds before a race against other cars. The camera
// flies over the track - its name, then its jumps, loops and tunnels - while one
// of the intro songs builds; then it finds each racer on the grid, back row
// first, and names them (the song drops on the first); it ends on your car and
// settles into the chase camera as the countdown starts. Space, Esc, a click or
// the pad's A skips it. Online it runs on the host's clock: the start is pushed
// back to fit it.
import * as THREE from 'three';
import { frameAt, gridSlot } from '../track/geometry.js';
import { BODIES } from '../car/bodies.js';
import { h } from '../ui/dom.js';
import { clamp, smoothstep, lerp } from '../util/math.js';

export const INTRO_LENGTH = 30;
const HERO = 4.2; // your car: a turn around it, then down into the chase camera
const SETTLE = 1.6; // the last part of that
const UP = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3(), _q = new THREE.Vector3(), _f = new THREE.Vector3(), _l = new THREE.Vector3();

export class RaceIntro {
  // watch: false (online, with the intro turned off here) only counts down to
  // the start the host pushed back
  constructor(app, session, { watch = true } = {}) {
    this.app = app;
    this.s = session;
    this.track = session.track;
    this.online = session.mode === 'online';
    this.player = session.player;
    this.t = 0;
    const touch = matchMedia('(pointer: coarse)').matches;
    this.el = h('div.intro',
      h('div.in-bars', h('i'), h('i')),
      this.titleEl = h('div.in-title'),
      this.cardEl = h('div.in-card'),
      h('div.in-ready', 'GET READY'),
      this.skipEl = h('div.in-skip', touch ? 'Tap to skip' : 'Space to skip'),
      this.waitEl = h('div.in-wait'),
      this.fadeEl = h('div.in-fade.on'));
    app.ui.root.append(this.el);
    if (!watch) { this.wait(); return; }

    this.state = this.online ? 'run' : 'cue'; // cue: waiting for the music to start
    this.hold = 0;
    // everyone but you, back of the grid first; then you
    this.order = session.entries.filter((e) => e.kind !== 'ghost' && e !== this.player).sort((a, b) => b.slot - a.slot);
    const n = this.order.length;
    this.per = n ? clamp(15.5 / n, 2.2, 4) : 0;
    this.fly = INTRO_LENGTH - HERO - n * this.per; // the flyover takes the rest
    this.cue = Math.max(0, (app.audio.introSong?.drop ?? 21) - this.fly); // the song drops on the first racer
    this.terrain = session.loaded.terrain;
    this.theme = session.loaded.theme;
    this.water = this.theme.ground === 'water' || this.theme.ground === 'lava' ? -1.2 : -Infinity;
    const racers = session.entries.filter((e) => e.kind !== 'ghost');
    this.gridBack = gridSlot(this.track, Math.max(0, ...racers.map((e) => e.slot))).s;
    this.shots = this.plan();
    this.titleCard();
    const fog = app.renderer.scene.fog;
    this.fog = fog ? { near: fog.near, far: fog.far } : null;
    session.camera.setMode('script');
    session.hold = !this.online; // parked on the grid; the countdown waits for us
    app.ui.hudLayer.classList.add('cinema');
    app.ui.touch.setActive(false);
    this._key = (e) => {
      if (e.code === 'Space' || (!this.online && (e.code === 'Enter' || e.code === 'NumpadEnter'))) { e.preventDefault(); this.skip(); }
    };
    this._click = () => this.skip();
    window.addEventListener('keydown', this._key);
    this.el.addEventListener('pointerdown', this._click);
    this.offPad = app.input.on('menuSelect', () => this.skip());
    if (!this.online) app.audio.playIntro(this.cue);
    this.frame(0);
  }

  // ---- clock ---------------------------------------------------------------------
  // seconds left until the countdown starts (online: on the host's clock)
  left() {
    const s = this.s;
    return (s.startAt - (this.app.net?.now() ?? performance.now())) / 1000 - s.countdown;
  }

  update(dt) {
    if (this.state === 'wait') {
      const left = this.left();
      if (left <= 0.05) { this.state = 'done'; this.el.remove(); return; }
      this.waitEl.textContent = `STARTING IN ${Math.ceil(left)}`;
      return;
    }
    if (this.state !== 'run' && this.state !== 'cue') return;
    const audio = this.app.audio;
    if (this.online) {
      this.t = INTRO_LENGTH - this.left();
      if (this.t < 0) { this.frame(0); return; } // here early: hold the opening frame
      if (!this.playing) { this.playing = true; audio.playIntro(this.cue + this.t); this.fadeEl.classList.remove('on'); }
    } else if (this.state === 'cue') {
      // hold the opening frame until the music is really playing, or clearly isn't coming
      this.hold += dt;
      const st = audio.introTime();
      if (st == null && this.hold < 2.5) { this.frame(0); return; }
      this.state = 'run';
      this.synced = st != null;
      this.t = Math.max(0, st ?? 0);
      this.fadeEl.classList.remove('on');
    } else {
      this.t += dt;
      // keep time with the song
      const st = this.synced ? audio.introTime() : null;
      if (st != null) this.t = Math.abs(st - this.t) > 0.25 ? st : this.t + (st - this.t) * 0.1;
    }
    if (!this.fading && this.t > INTRO_LENGTH - 1.2) { this.fading = true; audio.stopIntro(4); } // gone by GO
    if (this.t >= INTRO_LENGTH) { this.end(); return; }
    this.frame(this.t);
  }

  // Space, Esc, a click: cut to your car. Returns whether it did anything.
  skip() {
    if ((this.state !== 'run' && this.state !== 'cue') || this.skipping) return false;
    this.skipping = true;
    this.app.audio.stopIntro(0.8);
    this.fadeEl.classList.add('quick', 'on');
    setTimeout(() => { if (this.state === 'run' || this.state === 'cue') this.end(); }, 300);
    return true;
  }

  // hand the race back: chase camera, HUD, the countdown
  end() {
    const s = this.s, app = this.app;
    this.detach();
    this.restoreFog();
    s.camera.setMode(app.settings.camera || 'chase');
    s.camera.snap(s._camTarget(s.focus));
    s.hold = false;
    app.ui.hudLayer.classList.remove('cinema');
    if (app.ui.current === 'hud') app.ui.touch.setActive(true);
    app.ui.hud?.showHint();
    if (!this.fading) { this.fading = true; app.audio.stopIntro(this.skipping ? 0.8 : 3); }
    if (this.online && this.left() > 0.5) { this.wait(); return; }
    this.state = 'done';
    this.el.classList.add('leave');
    setTimeout(() => this.el.remove(), 700);
  }

  // online, cut short or turned off here: count down to the start
  wait() {
    this.state = 'wait';
    this.el.classList.add('waiting');
    this.fadeEl.classList.remove('on');
  }

  detach() {
    window.removeEventListener('keydown', this._key);
    this.el.removeEventListener('pointerdown', this._click);
    this.offPad?.();
    this.offPad = null;
  }

  // the race is over before the intro is (quit, disconnect)
  dispose() {
    if (this.state === 'run' || this.state === 'cue') this.app.audio.stopIntro(0.3);
    this.state = 'done';
    this.detach();
    this.restoreFog();
    this.app.ui.hudLayer.classList.remove('cinema');
    this.el.remove();
  }

  get cinematic() { return this.state === 'run' || this.state === 'cue'; }

  restoreFog() {
    const fog = this.app.renderer.scene.fog;
    if (fog && this.fog) { fog.near = this.fog.near; fog.far = this.fog.far; }
  }

  // ---- the shot list ---------------------------------------------------------------
  plan() {
    const shots = [];
    const F = this.fly;
    const A = clamp(F * 0.3, 3, 5); // the track's name over the whole of it
    const G = F - A >= 6.5 ? 3.6 : 0; // over the grid, front to back
    const mid = Math.max(0, F - A - G);
    const k = Math.round(mid / 3.6);
    let t = 0;
    const add = (d, shot) => { shots.push({ ...shot, t0: t, t1: t + d }); t += d; };
    add(k ? A : A + mid, { kind: 'aerial' });
    for (const f of this.features(k)) add(mid / k, f);
    if (G) add(G, { kind: 'approach' });
    this.order.forEach((e, i) => add(this.per, { kind: 'racer', e, style: i % 3, side: this.outSide(e) }));
    if (this.player) add(INTRO_LENGTH - t, { kind: 'hero', e: this.player, side: this.outSide(this.player) });
    return shots;
  }

  // the course's set pieces in race order - loops, jumps, tunnels - topped up
  // with drone runs along ordinary road
  features(k) {
    if (!k) return [];
    const tr = this.track, S = tr.samples, st = tr.start.s;
    const L = tr.closed ? tr.length : tr.finish.s - st;
    const along = (s) => (tr.closed ? (((s - st) % L) + L) % L : s - st);
    const found = [];
    for (let i = 0; i < S.length;) {
      const sm = S[i];
      let j = i + 1;
      if (sm.kind === 'LOOP') {
        while (j < S.length && S[j].kind === 'LOOP') j++;
        found.push({ kind: 'loop', a: sm.s, b: S[j - 1].s, rank: 3, ...this.loopShot(i, j) });
      } else if (sm.kind === 'K') {
        while (j < S.length && S[j].kind === 'K') j++;
        let g = j;
        while (g < S.length && S[g].kind === 'J') g++;
        if (g > j && g < S.length) found.push({ kind: 'jump', a: S[j - 1].s, b: S[g].s, rank: 2 });
        j = Math.max(j, g);
      } else if (sm.tunnel && sm.road) {
        while (j < S.length && S[j].tunnel) j++;
        if (S[j - 1].s - sm.s > 25) found.push({ kind: 'tunnel', a: sm.s, b: S[j - 1].s, rank: 1 });
      }
      i = j;
    }
    const inRace = found.filter((f) => along(f.a) > 20 && along(f.a) < L);
    inRace.sort((x, y) => y.rank - x.rank || along(x.a) - along(y.a));
    const pick = inRace.slice(0, k);
    // drone runs where nothing else is, and nowhere near a loop or tunnel
    const bad = found.filter((f) => f.kind !== 'jump');
    for (let tries = 0; pick.length < k && tries < 24; tries++) {
      const s = st + L * ((tries * 0.618 + 0.25) % 1);
      const clear = !bad.some((f) => s > f.a - 160 && s < f.b + 20) && !pick.some((f) => Math.abs(along(f.a) - along(s)) < 150);
      if (clear) pick.push({ kind: 'drone', a: s, side: tries % 2 ? 1 : -1 });
    }
    while (pick.length < k) pick.push({ kind: 'drone', a: st + L * (pick.length + 0.5) / (k + 1), side: 1 });
    for (const f of pick) if (f.kind === 'jump') f.side = this.clearSide((f.a + f.b) / 2, 20);
    return pick.sort((x, y) => along(x.a) - along(y.a));
  }

  // a loop: its middle, which way it faces, and a side to watch it from
  loopShot(i, j) {
    const S = this.track.samples;
    const c = new THREE.Vector3();
    for (let k = i; k < j; k++) c.add(S[k].p);
    c.divideScalar(j - i);
    const a = S[i];
    const lat = new THREE.Vector3(a.l.x, 0, a.l.z).normalize();
    const side = this.clearSide(a.s, 36, c);
    return { c, lat, fwd: new THREE.Vector3(a.t.x, 0, a.t.z).normalize(), side };
  }

  // which side of the road has the open view: lower ground, no other road
  clearSide(s, d, from = null) {
    const f = frameAt(this.track, s);
    const base = from || f.p;
    let best = 1, score = Infinity;
    for (const side of [1, -1]) {
      const p = _p.copy(base).addScaledVector(f.l, side * d);
      let sc = Math.max(0, this.ground(p) - f.p.y);
      for (let k = 0; k < this.track.samples.length; k += 6) {
        const sm = this.track.samples[k];
        if (Math.abs(sm.s - s) < 60) continue;
        if (sm.p.distanceToSquared(p) < 16 * 16) sc += 40;
      }
      if (sc < score) { score = sc; best = side; }
    }
    return best;
  }

  // which side of its car the camera stands: the outside of the grid
  outSide(e) {
    const sp = e.race.spawn;
    const f = frameAt(this.track, sp.s ?? this.track.start.s);
    return _p.copy(sp.pos).sub(f.p).dot(f.l) >= 0 ? 1 : -1;
  }

  ground(p) {
    if (!this.terrain || this.theme.ground === 'void') return -Infinity;
    return Math.max(this.terrain.meshHeightAt(p.x, p.z), this.water);
  }

  // keep the camera clear of the ground
  above(p, m) {
    const g = this.ground(p) + m;
    if (p.y < g) p.y = g;
    return p;
  }

  // a point by the road: s along it, x to the left, y up
  at(s, x, y, out) {
    const f = frameAt(this.track, s);
    return out.copy(f.p).addScaledVector(f.l, x).addScaledVector(UP, y);
  }

  // ---- drawing a frame -------------------------------------------------------------
  frame(T) {
    const sh = this.shots.find((x) => T < x.t1) || this.shots[this.shots.length - 1];
    const u = clamp((T - sh.t0) / Math.max(0.01, sh.t1 - sh.t0), 0, 1);
    const d = sh.t1 - sh.t0;
    if (sh !== this.cur) { this.cur = sh; this.cut(sh); }
    const fog = this.app.renderer.scene.fog;
    if (fog && this.fog && sh.kind !== 'aerial') { fog.near = this.fog.near; fog.far = this.fog.far; }
    this[sh.kind](sh, u, d, T);
    this.titleEl.classList.toggle('on', sh === this.shots[0] && T > 0.3 && T < sh.t1 - 0.35);
    this.skipEl.classList.toggle('on', T > 1);
    this.el.classList.toggle('settle', sh.kind === 'hero' && T > INTRO_LENGTH - SETTLE);
  }

  cut(sh) {
    if (sh.kind === 'racer' || sh.kind === 'hero') this.cardEl.replaceChildren(this.card(sh.e, sh.kind === 'hero'));
    else this.cardEl.replaceChildren();
  }

  cam(pos, look, fov) {
    const c = this.app.renderer.camera;
    c.position.copy(pos);
    c.up.set(0, 1, 0);
    c.lookAt(look);
    if (c.fov !== fov) { c.fov = fov; c.updateProjectionMatrix(); }
    this.app.renderer.followShadow(look); // shadows where we're looking
  }

  // the whole track from high up, turning slowly
  aerial(sh, u, d) {
    const b = this.track.bounds;
    const c = _q.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
    const R = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2;
    const D = Math.min(2 * R + 40, 900) * (1.04 - 0.08 * u);
    if (this.a0 == null) { const sp = this.track.start.p; this.a0 = Math.atan2(sp.x - c.x, sp.z - c.z); }
    const a = this.a0 + u * d * 0.045;
    const p = _p.set(c.x + Math.sin(a) * D * 0.78, c.y + D * 0.62, c.z + Math.cos(a) * D * 0.78);
    const fog = this.app.renderer.scene.fog;
    if (fog && this.fog) { fog.near = Math.max(this.fog.near, D * 0.8); fog.far = Math.max(this.fog.far, D * 2.4); }
    this.cam(p, c, 40);
  }

  // a drone up the ramp and out over the gap, the landing ahead
  jump(sh, u) {
    const s = lerp(sh.a - 34, sh.a + 6, u);
    const p = this.above(this.at(s, sh.side * 3, lerp(5, 9, u), _p), 3);
    this.cam(p, this.at(sh.b + 12, 0, 0, _q), 54);
  }

  // side-on to a loop, drifting past it
  loop(sh, u) {
    const p = _p.copy(sh.c).addScaledVector(sh.lat, sh.side * 38).addScaledVector(sh.fwd, lerp(-12, 12, u));
    p.y = sh.c.y - 2;
    this.above(p, 2);
    this.cam(p, sh.c, 46);
  }

  // down the road into a tunnel
  tunnel(sh, u) {
    this.cam(this.above(this.at(sh.a - lerp(40, 22, u), 0, 3.4, _p), 2), this.at(sh.a + 12, 0, 2.2, _q), 50);
  }

  // a drone run along the road
  drone(sh, u, d) {
    const s = sh.a + u * d * 26;
    this.cam(this.above(this.at(s, sh.side * 5, 9, _p), 4), this.at(s + 42, 0, 1.2, _q), 55);
  }

  // over the start and back along the grid, the cars' noses below
  approach(sh, u) {
    const e = smoothstep(0, 1, u) * 0.85 + u * 0.15;
    const s = lerp(this.track.start.s + 34, this.gridBack - 2, e);
    this.cam(this.at(s, 0, lerp(20, 8.5, e), _p), this.at(s - 24, 0, 0.5, _q), 52);
  }

  // the car's position, forward and outward (away from the middle of the grid)
  pose(e, side) {
    const g = e.model.group;
    _f.set(0, 0, 1).applyQuaternion(g.quaternion).setY(0).normalize();
    _l.set(_f.z, 0, -_f.x).multiplyScalar(side);
    return g.position;
  }

  // one racer, three ways of looking at them (none looks down the grid at the
  // start: its gantry and glow fill the frame)
  racer(sh, u) {
    const c = this.pose(sh.e, sh.side);
    const p = _p.copy(c), look = _q.copy(c).addScaledVector(UP, 0.5);
    let fov;
    switch (sh.style) {
      case 0: // front three-quarter, low, drifting round
        p.addScaledVector(_f, lerp(6.2, 5.2, u)).addScaledVector(_l, lerp(3.2, 4.4, u)).addScaledVector(UP, 0.95); fov = 36; break;
      case 1: // alongside, tail to nose
        p.addScaledVector(_l, 6.6).addScaledVector(_f, lerp(-2.8, 2.8, u)).addScaledVector(UP, 1.25);
        look.addScaledVector(_f, lerp(-0.6, 0.6, u)); fov = 34; break;
      default: // low off the front corner, pushing in (clear of the car ahead)
        p.addScaledVector(_f, lerp(5.4, 4.6, u)).addScaledVector(_l, 3.3).addScaledVector(UP, 0.45); fov = 34; break;
    }
    this.cam(p, look, fov);
  }

  // you: round the front of your car, then down behind it into the chase camera
  hero(sh, u, d, T) {
    const c = this.pose(sh.e, sh.side);
    const orbit = d - SETTLE;
    const k = smoothstep(0, 1, (T - (INTRO_LENGTH - SETTLE)) / SETTLE);
    const a = k > 0 ? lerp(1.45, Math.PI, k) : lerp(0.55, 1.45, clamp((u * d) / orbit, 0, 1));
    const r = lerp(6.4, 6.8, k), y = lerp(1.05, 2.1, k);
    const p = _p.copy(c).addScaledVector(_f, Math.cos(a) * r).addScaledVector(_l, Math.sin(a) * r).addScaledVector(UP, y);
    const look = _q.copy(c).addScaledVector(UP, 0.6);
    let fov = 40;
    if (k > 0) {
      if (!this.chase) this.chase = this.chasePose();
      p.lerp(this.chase.pos, k * k);
      look.lerp(this.chase.look, k);
      fov = lerp(40, this.chase.fov, k);
    }
    this.cam(p, look, fov);
  }

  // where the race camera will be once we let go
  chasePose() {
    const s = this.s, cam = s.camera;
    cam.setMode(this.app.settings.camera || 'chase');
    cam.snap(s._camTarget(s.focus));
    const pose = { pos: cam.pos.clone(), look: cam.look.clone(), fov: cam.camera.fov };
    cam.setMode('script');
    return pose;
  }

  // ---- words on screen -------------------------------------------------------------
  titleCard() {
    const s = this.s, tr = this.track;
    const len = tr.closed ? tr.length : tr.finish.s - tr.start.s;
    const racers = this.order.length + (this.player ? 1 : 0);
    const bits = [this.theme?.name, tr.closed ? `${s.laps} laps` : 'Sprint', (len / 1000).toFixed(1) + ' km', `${racers} racers`];
    this.titleEl.replaceChildren(h('b', s.opts.def.name), h('span', bits.filter(Boolean).join(' · ')));
  }

  card(e, you) {
    const c = e.custom || {};
    const body = BODIES[c.body];
    const name = (e.name || 'Racer').replace(/\s*\(AI\)$/, '');
    const what = [e.kind === 'bot' ? 'AI' : null, body?.name, c.showNumber !== false && c.number != null ? '#' + c.number : null];
    return h('div.in-name' + (you ? '.you' : ''), { style: { '--c': c.paint || '#39c6f0' } },
      h('div.in-pos', 'P' + (e.slot + 1)),
      h('div.in-who', you ? h('em', 'YOU') : null, h('b', name.toUpperCase()), h('span', what.filter(Boolean).join(' · ').toUpperCase())));
  }
}
