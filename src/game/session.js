// A race on one track: world view, racers (player, bots, ghost, remote), the
// countdown, fixed-step physics with render interpolation, respawns, timing,
// effects and the data the HUD shows.
import * as THREE from 'three';
import { loadTrack } from '../track/load.js';
import { WorldView } from '../render/world.js';
import { Car } from '../physics/car.js';
import { buildCar } from '../car/model.js';
import { Effects, addFlames } from '../render/effects.js';
import { RaceState, gridSpawn } from './race.js';
import { Progress } from './progress.js';
import { AIDriver } from './ai.js';
import { ChaseCamera } from './camera.js';
import { GhostRecorder, GhostPlayer } from './ghost.js';
import { setStartLights } from '../render/trackview.js';
import { SURF } from '../track/builder.js';
import { frameAt } from '../track/geometry.js';
import { clamp } from '../util/math.js';
import { TrackLimits, missedGate } from './rules.js';
import { collideCars } from '../physics/contact.js';

export const DT = 1 / 120;
const COUNT_RACE = 3.0;
const COUNT_TT = 2.1;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();

export class Session {
  // opts: { def, mode: 'timetrial'|'race'|'online'|'demo', laps, player: {name, custom}, bots: [{name, custom, skill}],
  //         ghost: encoded|null, net: adapter|null, remotes: [{id,name,custom,slot}], slot }
  constructor(app, opts) {
    this.app = app;
    this.opts = opts;
    this.mode = opts.mode || 'timetrial';
    this.renderer = app.renderer;
    const t0 = performance.now();
    this.loaded = loadTrack(opts.def);
    this.track = this.loaded.track;
    this.world = this.loaded.world;
    this.laps = this.track.closed ? opts.laps || opts.def.laps || 3 : 0;
    this.view = new WorldView(this.renderer, this.loaded, { decor: this.renderer.quality.decor });
    this.effects = new Effects(this.renderer.scene);
    this.camera = new ChaseCamera(this.renderer.camera);
    this.camera.setMode(app.settings?.camera || 'chase');
    this.camera.baseFov = app.settings?.fov || 70;
    this.entries = [];
    this.time = 0; // race clock (s), negative during countdown
    this.countdown = this.mode === 'timetrial' ? COUNT_TT : COUNT_RACE;
    this.state = 'countdown';
    this.clock = 0;
    this.acc = 0;
    this.events = [];
    this.messages = [];
    this.paused = false;
    this.spectate = null;
    this.startAt = null; // wall-clock start for online races
    this.loadMs = performance.now() - t0;

    let slot = 0;
    if (opts.player) {
      this.player = this._addEntry({ kind: this.mode === 'demo' ? 'bot' : 'player', id: opts.playerId || 'me', name: opts.player.name, custom: opts.player.custom, slot: opts.slot ?? slot++ });
      if (opts.slot != null) slot = 0;
    }
    for (const b of opts.bots || []) {
      while (opts.remotes && opts.remotes.some((r) => r.slot === slot) || (this.player && this.player.slot === slot)) slot++;
      this._addEntry({ kind: 'bot', id: b.id || 'bot' + slot, name: b.name, custom: b.custom, skill: b.skill, slot: b.slot ?? slot++ });
    }
    for (const r of opts.remotes || []) this._addEntry({ kind: 'remote', id: r.id, name: r.name, custom: r.custom, slot: r.slot });
    if (opts.ghost) {
      try {
        this.ghostPlayer = new GhostPlayer(opts.ghost);
        this.ghost = this._addEntry({ kind: 'ghost', id: 'ghost', name: 'Personal best', custom: opts.ghost.meta?.custom || opts.player?.custom, slot: this.player?.slot ?? 0 });
        this.ghost.model.setOpacity(0.38);
      } catch (e) { console.warn('ghost load failed', e); }
    }
    this.recorder = this.player && this.mode !== 'demo' ? new GhostRecorder() : null;
    this.focus = this.player || this.entries[0];
    if (this.loaded.theme.night) {
      // one real spotlight on the car you're watching lights the road at night
      const lamp = new THREE.SpotLight(0xfff0d8, 1800, 90, 0.52, 0.55, 1.6);
      lamp.position.set(0, 0.25, 2.1);
      lamp.target.position.set(0, -1.2, 22);
      this.headlight = lamp;
      this._attachHeadlight();
    }
    this.camera.snap(this._camTarget(this.focus));
    setStartLights(this.view.track, 0);
  }

  _attachHeadlight() {
    const lamp = this.headlight;
    if (!lamp || !this.focus) return;
    lamp.parent?.remove(lamp);
    lamp.target.parent?.remove(lamp.target);
    this.focus.model.group.add(lamp, lamp.target);
  }

  _addEntry({ kind, id, name, custom, skill = 1, slot = 0 }) {
    const e = { kind, id, name, custom, slot, skill };
    e.race = new RaceState(this.track, { laps: this.laps, slot });
    e.prog = new Progress(this.track, this.track.start.index);
    e.model = buildCar(custom, { envMap: this.view.envMap, shadows: this.renderer.quality.shadows });
    addFlames(e.model, custom?.trail || '#39e6ff');
    this.renderer.scene.add(e.model.group);
    e.pos = e.race.spawn.pos.clone();
    e.quat = e.race.spawn.quat.clone();
    e.prevPos = e.pos.clone();
    e.prevQuat = e.quat.clone();
    e.vel = new THREE.Vector3();
    e.wheelSpin = 0;
    e.place = 0;
    if (kind === 'player' || kind === 'bot') {
      e.car = new Car(this.world);
      e.car.reset(e.pos, e.quat);
      e.limits = new TrackLimits(this.track);
      if (kind === 'bot') {
        e.ai = new AIDriver(this.track, this.loaded.line, this.loaded.speeds, { skill, seed: slot + 1 });
        e.prog.update(e.pos);
        e.ai.startLane(e.prog.lat, e.prog);
      }
    }
    if (kind === 'remote') { e.snaps = []; e.lastSeen = 0; }
    e.prog.update(e.pos);
    this.entries.push(e);
    return e;
  }

  removeEntry(id) {
    const i = this.entries.findIndex((e) => e.id === id);
    if (i < 0) return;
    const e = this.entries[i];
    this.renderer.scene.remove(e.model.group);
    e.model.dispose();
    this.entries.splice(i, 1);
  }

  emit(type, data = {}) { this.events.push({ type, ...data }); }
  message(text, kind = 'info', dur = 1.6) { this.messages.push({ text, kind, until: this.clock + dur }); }

  // ---- main update -------------------------------------------------------------
  update(dt, input) {
    dt = Math.min(dt, 0.1);
    this.clock += dt;
    if (this.paused) { this._render(0, dt); return; }
    // online races start on the host's clock
    if (this.state === 'countdown' && this.startAt != null) {
      const now = this.app.net?.now() ?? performance.now();
      this.countdownLeft = (this.startAt - now) / 1000;
    }
    // Online, the race clock is the shared wall clock (host time), so finish
    // times stay comparable even if this machine hitches: we simulate as many
    // steps as it takes to catch up (up to a quarter second per frame).
    let maxSteps = 12;
    if (this.startAt != null && this.state !== 'countdown') {
      const now = this.app.net?.now() ?? performance.now();
      const target = (now - this.startAt) / 1000;
      this.acc = Math.max(0, Math.min(0.25, target - this.time));
      maxSteps = 30;
    } else this.acc += dt;
    let steps = 0;
    while (this.acc >= DT && steps < maxSteps) {
      this._fixed(DT, input);
      this.acc -= DT;
      steps++;
    }
    if (steps >= maxSteps) this.acc = 0;
    this._render(this.acc / DT, dt, input);
  }

  _fixed(dt, input) {
    // countdown
    if (this.state === 'countdown') {
      // three steps (lights 2, 4, 5 of the gantry), then green
      if (this.startAt != null) this._cd = this.countdownLeft;
      else this._cd = (this._cd ?? this.countdown) - dt;
      const step = this.countdown / 3;
      const lit = this._cd > this.countdown ? 0 : clamp(3 - Math.floor(this._cd / step), 1, 3);
      if (lit !== this._lit && this._cd > 0) {
        this._lit = lit;
        if (lit > 0) { setStartLights(this.view.track, [0, 2, 4, 5][lit]); this.emit('count', { n: 4 - lit }); }
      }
      this.time = -Math.max(0, this._cd);
      if (this._cd <= 0) {
        this.state = 'racing';
        this.time = 0;
        setStartLights(this.view.track, 'go');
        this.emit('go');
        this.message('GO!', 'go', 1.0);
      }
    } else {
      this.time += dt;
    }
    const racing = this.state !== 'countdown';

    // 1. move everything
    if (racing && (this._trafficT = (this._trafficT || 0) - dt) <= 0) { this._trafficT = 0.1; this._traffic(); }
    for (const e of this.entries) {
      if (e.car) {
        e.prevPos.copy(e.car.pos);
        e.prevQuat.copy(e.car.quat);
        const car = e.car;
        if (!racing) {
          const s = e.kind === 'player' ? input : null;
          car.input.throttle = 0; car.input.brake = 0; car.input.hold = true; car.input.steer = s ? s.steer : 0; car.input.handbrake = 0;
          e.rev = s ? s.throttle : 0;
        } else if (e.kind === 'player' && !e.race.finished && !this.autopilot) {
          car.input.hold = false;
          car.input.throttle = input.throttle; car.input.brake = input.brake; car.input.steer = input.steer;
          car.input.handbrake = input.handbrake; car.input.analog = input.analog;
          e.rev = 0;
        } else {
          car.input.hold = false;
          if (!e.ai) e.ai = new AIDriver(this.track, this.loaded.line, this.loaded.speeds, { skill: e.kind === 'player' ? 0.72 : e.skill, seed: 3 });
          e.ai.drive(car, e.prog, dt);
          if (e.race.finished) {
            // sprints: coast to a stop on the run-off; circuits: a steady cool-down lap
            if (!this.track.closed) { car.input.throttle = 0; car.input.brake = car.forwardSpeed > 2 ? 0.55 : 0; }
            else car.input.throttle = Math.min(car.input.throttle, car.forwardSpeed < 22 ? 0.6 : 0);
          }
        }
        const rs = this.track.samples[e.prog.index];
        car.rampLeft = rs.kind === 'K' && rs.road ? rs.l : null;
        car.step(dt);
      } else if (e.kind === 'remote') {
        this._remotePose(e, dt);
      } else if (e.kind === 'ghost') {
        e.prevPos.copy(e.pos); e.prevQuat.copy(e.quat);
        const t = Math.max(0, this.time);
        const alive = this.ghostPlayer.sample(t, e.pos, e.quat, e.vel);
        e.model.group.visible = racing ? alive || t < this.ghostPlayer.duration + 1 : true;
        e.prog.update(e.pos);
      }
    }
    // 2. cars that touch push each other apart
    this._contacts();
    // 3. progress, pads, gates, track limits
    for (const e of this.entries) {
      const car = e.car;
      if (!car) continue;
      e.prog.update(car.pos);
      const sm = this.track.samples[e.prog.index];
      if (sm.boost && Math.abs(e.prog.vert) < 1.6 && Math.abs(e.prog.lat) < sm.hw - 1) {
        if (car.boost < 0.2) { this.emit('boost', { id: e.id }); }
        car.boost = Math.max(car.boost, 1.35);
      }
      if (racing) {
        const ev = e.race.cross(e.prevPos, car.pos, this.time, dt, car.forwardSpeed);
        if (ev) this._gateEvent(e, ev);
      }
      this._autoRespawn(e, dt);
      if (e.kind === 'player' && this.recorder && racing && !e.race.finished) this.recorder.sample(this.time, car.pos, car.quat, car.steer);
      e.pos.copy(car.pos); e.quat.copy(car.quat); e.vel.copy(car.vel);
    }
    if (racing) this._standings();
    // gentle catch-up on the easier AI levels: bots ease off when far ahead of
    // the player and push a little when far behind
    if (racing && this.opts.rubber && this.player && !this.player.race.finished) {
      const pc = this.player.completion || 0;
      const L = this.track.length * Math.max(1, this.laps);
      for (const e of this.entries) {
        if (e.kind !== 'bot' || !e.ai) continue;
        const gap = ((e.completion || 0) - pc) * L;
        const k = gap > 120 ? -Math.min(0.08, (gap - 120) / 2500) : gap < -120 ? Math.min(0.04, (-gap - 120) / 3000) : 0;
        e.ai.skill = e.skill * (1 + k);
      }
    }
  }

  // ---- remote cars (online) ------------------------------------------------------
  remoteSnapshot(id, m) {
    const e = this.entries.find((x) => x.id === id);
    if (!e || e.kind !== 'remote') return;
    const snaps = e.snaps;
    const last = snaps[snaps.length - 1];
    if (last && m.ts < last.ts - 1) snaps.length = 0; // their clock jumped (reset)
    else if (last && m.ts <= last.ts) return; // stale or duplicate
    snaps.push(m);
    if (snaps.length > 8) snaps.shift();
    e.completion = m.c;
    if (m.l != null) e.race.lap = m.l;
    e.remoteGhost = !!m.g;
    e.lastSeen = this.clock;
  }

  remoteFinish(id, time) {
    const e = this.entries.find((x) => x.id === id);
    if (!e) return;
    e.finishTime = time;
    if (e.kind === 'remote') { e.race.finished = true; e.race.finishTime = time; }
  }

  // Remote cars are shown where they are *now* on the shared race clock:
  // dead-reckoned from their latest snapshot (velocity plus the acceleration
  // and turn rate between the last two), with corrections blended in. Drawing
  // them in the past would put a car racing alongside you metres behind where
  // it really is - and cars now touch.
  _remotePose(e, dt) {
    e.prevPos.copy(e.pos); e.prevQuat.copy(e.quat);
    const snaps = e.snaps;
    if (!snaps.length) return;
    const a = snaps[snaps.length - 1], b = snaps.length > 1 ? snaps[snaps.length - 2] : null;
    const ahead = clamp(this.time - a.ts, 0, 0.3);
    const span = b ? a.ts - b.ts : 0;
    let ax = 0, ay = 0, az = 0;
    if (span > 0.02) {
      ax = (a.v[0] - b.v[0]) / span; ay = (a.v[1] - b.v[1]) / span; az = (a.v[2] - b.v[2]) / span;
      const al = Math.hypot(ax, ay, az);
      if (al > 30) { ax *= 30 / al; ay *= 30 / al; az *= 30 / al; }
    }
    const h2 = 0.5 * ahead * ahead;
    _v.set(a.p[0] + a.v[0] * ahead + ax * h2, a.p[1] + a.v[1] * ahead + ay * h2, a.p[2] + a.v[2] * ahead + az * h2);
    const jump = !e._seen || _v.distanceToSquared(e.pos) > 64; // first sight or a reset
    if (jump) e.pos.copy(_v);
    else e.pos.addScaledVector(e.vel, dt).lerp(_v, 1 - Math.exp(-dt * 10));
    e.vel.set(a.v[0] + ax * ahead, a.v[1] + ay * ahead, a.v[2] + az * ahead);
    _q2.set(a.q[0], a.q[1], a.q[2], a.q[3]).normalize();
    if (span > 0.02 && ahead > 0) {
      // keep turning at the rate it was turning between the last two snapshots
      _q3.set(b.q[0], b.q[1], b.q[2], b.q[3]).normalize().invert().premultiply(_q2);
      if (_q3.w < 0) { _q3.x = -_q3.x; _q3.y = -_q3.y; _q3.z = -_q3.z; _q3.w = -_q3.w; }
      const sinH = Math.hypot(_q3.x, _q3.y, _q3.z);
      const ang = 2 * Math.atan2(sinH, _q3.w);
      if (sinH > 1e-6 && ang < 1.2) {
        _v2.set(_q3.x / sinH, _q3.y / sinH, _q3.z / sinH);
        _q3.setFromAxisAngle(_v2, ang * Math.min(ahead / span, 3));
        _q2.premultiply(_q3);
      }
    }
    if (jump) e.quat.copy(_q2); else e.quat.slerp(_q2, 1 - Math.exp(-dt * 12));
    e._seen = true;
    e.steer = a.st || 0;
    e.boost = a.b;
    e.prog.update(e.pos);
  }

  // ---- cars touching -----------------------------------------------------------
  // Nobody collides while "ghosted": just after being put back on the road (and
  // until clear of other cars), once finished, or the personal-best ghost.
  ghosted(e) {
    if (e.kind === 'ghost') return true;
    if (e.race?.finished || e.finishTime != null) return true;
    if (e.kind === 'remote') return !!e.remoteGhost;
    return e.ghostUntil > this.clock;
  }

  _contacts() {
    const list = this._bodies || (this._bodies = []);
    list.length = 0;
    for (const e of this.entries) {
      if (e.kind === 'ghost' || !e.model.group.visible) continue;
      // a ghost period ends only once the car is clear of everybody
      if (e.ghostUntil && e.ghostUntil <= this.clock) {
        const p = e.car ? e.car.pos : e.pos;
        const blocked = this.entries.some((o) => o !== e && o.kind !== 'ghost' && !this.ghosted(o) && (o.car ? o.car.pos : o.pos).distanceToSquared(p) < 5 * 5);
        if (blocked) e.ghostUntil = this.clock + 0.2; else e.ghostUntil = 0;
      }
      if (this.ghosted(e)) continue;
      const b = e._body || (e._body = { pos: null, vel: null, fwd: new THREE.Vector3(), up: new THREE.Vector3(), car: null });
      if (e.car) { b.pos = e.car.pos; b.vel = e.car.vel; b.fwd.copy(e.car.fwd); b.up.copy(e.car.up); b.car = e.car; }
      else { b.pos = e.pos; b.vel = e.vel; b.fwd.set(0, 0, 1).applyQuaternion(e.quat); b.up.set(0, 1, 0).applyQuaternion(e.quat); b.car = null; }
      b.e = e;
      list.push(b);
    }
    for (let i = 0; i < list.length; i++) {
      for (let k = i + 1; k < list.length; k++) {
        const A = list[i], B = list[k];
        if (!A.car && !B.car) continue; // two remote cars: their owners sort it out
        const j = collideCars(A, B);
        if (j > 1500 && (A.e === this.focus || B.e === this.focus)) this.emit('bump', { j });
      }
    }
  }

  // what each AI driver can see of the cars around it (refreshed 10x a second)
  _traffic() {
    const cars = [];
    for (const e of this.entries) {
      if (e.kind === 'ghost' || this.ghosted(e) || !e.model.group.visible) continue;
      const sm = this.track.samples[e.prog.index];
      const v = e.car ? e.car.vel : e.vel;
      cars.push({ e, s: e.prog.s ?? sm.s, lat: e.prog.lat, v: v.x * sm.t.x + v.y * sm.t.y + v.z * sm.t.z });
    }
    for (const e of this.entries) if (e.ai) e.ai.traffic = cars.filter((c) => c.e !== e);
  }

  _gateEvent(e, ev) {
    if (ev.kind === 'arm') return;
    if (e.kind === 'player') {
      const pb = this.opts.pbSplits;
      const idx = e.race.cpTimes.length - 1;
      const delta = pb && pb[idx] != null ? ev.time - pb[idx] : null;
      if (ev.kind === 'cp') { this.emit('checkpoint', { time: ev.time, delta, index: idx }); }
      if (ev.kind === 'lap') {
        this.emit('lap', { time: ev.time, lap: ev.lap, delta });
        if (ev.lap === this.laps - 1) this.message('FINAL LAP', 'lap', 1.8);
      }
      if (ev.kind === 'finish') {
        this.emit('finish', { time: ev.time, delta, splits: e.race.cpTimes.slice() });
        this.state = this.entries.every((x) => x.kind !== 'bot' && x.kind !== 'remote' || x.race.finished) ? 'done' : 'finished';
        this.finishClock = this.clock;
      }
    } else if (ev.kind === 'finish') {
      this.emit('otherFinish', { id: e.id, time: ev.time });
    }
    if (ev.kind === 'finish') e.finishTime = ev.time;
  }

  // Track limits: off the road a 3 s clock runs (the HUD shows it) and you're
  // put back where you left; skipping a gate or cutting the course sends you
  // back too. There is no manual respawn.
  _autoRespawn(e, dt) {
    if (this.state === 'countdown') return;
    let why = e.race.finished && !this.track.closed ? null : e.limits.update(e.car, e.prog, dt);
    if (!why && this.clock - (e.lastRespawn || -9) > 1.5 && missedGate(e.race, e.prog, this.track)) why = 'missed';
    if (e.ai?.wantRespawn) { e.ai.wantRespawn = false; why = 'stuck'; }
    if (!why) return;
    if (e === this.focus) {
      if (why === 'missed') this.message('MISSED CHECKPOINT', 'warn', 2.2);
      else if (why === 'cut') this.message('SHORTCUT - PUT BACK', 'warn', 2.2);
    }
    this.respawn(e, why);
  }

  respawn(e, why) {
    if (!e.car || this.state === 'countdown') return;
    const r = why === 'missed' ? e.race.respawn : e.limits.placement(why, e.prog, this.loaded.speeds);
    e.car.reset(r.pos, r.quat, r.speed || 0);
    e.prevPos.copy(r.pos); e.prevQuat.copy(r.quat);
    e.prog.reset(r.index ?? this.track.start.index);
    e.prog.update(e.car.pos);
    e.race.respawns++;
    e.lastRespawn = this.clock;
    e.limits.reset();
    e.ghostUntil = this.clock + 2; // pass through other cars until clear of them
    if (e.ai) { e.ai.stuck = 0; e.ai.reverseTime = 0; e.ai.fails = 0; }
    for (let w = 0; w < 4; w++) this.effects.endSkid(e.id + w);
    if (e === this.focus) this.camera.snap(this._camTarget(e));
    this.emit('respawn', { id: e.id, why });
  }

  _standings() {
    const list = this.entries.filter((e) => e.kind !== 'ghost');
    for (const e of list) {
      if (e.kind === 'remote') continue; // completion comes over the wire
      e.completion = e.race.completion(e.prog.s ?? 0);
    }
    list.sort((a, b) => {
      const fa = a.race.finished || a.finishTime != null, fb = b.race.finished || b.finishTime != null;
      if (fa && fb) return (a.finishTime ?? a.race.finishTime) - (b.finishTime ?? b.race.finishTime);
      if (fa !== fb) return fa ? -1 : 1;
      return (b.completion || 0) - (a.completion || 0);
    });
    list.forEach((e, i) => (e.place = i + 1));
    this.standings = list;
  }

  // ---- rendering ----------------------------------------------------------------
  _render(alpha, dt, input) {
    const t = this.clock;
    for (const e of this.entries) {
      const g = e.model.group;
      if (e.car) {
        g.position.lerpVectors(e.prevPos, e.car.pos, alpha);
        g.quaternion.slerpQuaternions(e.prevQuat, e.car.quat, alpha);
        e.model.syncWheels(e.car.wheels);
        e.model.setBoost(e.car.boost > 0 ? Math.min(1, e.car.boost * 1.4) : 0, t);
        this._carEffects(e, dt);
      } else {
        g.position.lerpVectors(e.prevPos, e.pos, alpha);
        g.quaternion.slerpQuaternions(e.prevQuat, e.quat, alpha);
        const sp = e.vel.length();
        e.wheelSpin = (e.wheelSpin + (sp / 0.36) * dt) % (Math.PI * 2);
        e.model.syncWheels([0, 1, 2, 3].map((i) => ({ comp: 0.087, steerAngle: i < 2 ? (e.steer || 0) * 0.3 : 0, spin: e.wheelSpin })));
        e.model.setBoost(e.boost ? 1 : 0, t);
      }
    }
    // see-through while ghosted: just put back on the road, or (other cars)
    // already finished - you drive through them
    for (const e of this.entries) {
      if (e.kind === 'ghost') continue;
      const reset = e.kind === 'remote' ? e.remoteGhost : e.ghostUntil > t;
      const done = e !== this.focus && (e.race.finished || e.finishTime != null);
      const a = reset ? 0.4 : done ? 0.55 : 1;
      if (Math.abs((e._alpha ?? 1) - a) > 0.05) { e._alpha = a; e.model.setOpacity(a); }
    }
    const focus = this.focus;
    if (focus) {
      const target = this._camTarget(focus);
      this.camera.update(target, dt || 1 / 60, this.world, input?.lookBack);
      this.renderer.followShadow(target.pos);
      if (focus.car && focus.kind === 'player') {
        if (focus.car.landing > 6) this.camera.shake = Math.max(this.camera.shake, Math.min(1.2, focus.car.landing / 12));
        if (focus.car.impact > 3000) this.camera.shake = Math.max(this.camera.shake, Math.min(1.5, focus.car.impact / 9000));
      }
    }
    this.view.update(t, this.renderer.camera.position, dt || 1 / 60);
    this.effects.update(dt || 0);
  }

  _camTarget(e) {
    const g = e.model.group;
    const q = g.quaternion;
    // the road frame under the car, while the car is actually on (or just over) it
    const pr = e.prog;
    const sm = this.track.samples[pr.index];
    const near = sm && sm.road && Math.abs(pr.lat) < sm.hw + 3 && pr.vert > -2 && pr.vert < 4;
    return {
      pos: g.position,
      quat: q,
      fwd: _v.set(0, 0, 1).applyQuaternion(q).clone(),
      up: _v2.set(0, 1, 0).applyQuaternion(q).clone(),
      vel: e.car ? e.car.vel : e.vel,
      boost: e.car ? e.car.boost : 0,
      grounded: e.car ? e.car.grounded : true,
      road: near ? frameAt(this.track, pr.s ?? sm.s) : null,
    };
  }

  _carEffects(e, dt) {
    const car = e.car;
    const near = e === this.focus || e.model.group.position.distanceToSquared(this.renderer.camera.position) < 90 * 90;
    for (let i = 0; i < 4; i++) {
      const w = car.wheels[i];
      const key = e.id + i;
      const drifting = w.contact && (w.slip > 3.2 || w.slipLong > 2.5 || (!w.front && car.rearGrip < 0.8 && car.speed > 8));
      const onRoad = w.surf === SURF.asphalt || w.surf === SURF.line || w.surf === SURF.boost;
      if (drifting && near && car.speed > 4) {
        _v.set(w.px, w.py, w.pz);
        _v2.copy(car.vel).normalize();
        if (onRoad) this.effects.skid(key, _v, new THREE.Vector3(w.nx, w.ny, w.nz), _v2, clamp(w.slip / 8, 0.35, 1));
        if (!w.front && Math.random() < dt * (onRoad ? 26 : 40)) {
          const col = onRoad ? 0xe9ecef : w.surf === SURF.grass ? 0x7f9f5a : w.surf === SURF.sand ? 0xd8c089 : w.surf === SURF.ice ? 0xeef8ff : 0x9a7b55;
          this.effects.puff(_v.clone().add(new THREE.Vector3(0, 0.25, 0)), car.vel.clone().multiplyScalar(0.25).add(new THREE.Vector3((Math.random() - 0.5) * 2, 1.2, (Math.random() - 0.5) * 2)), 0.45 + Math.random() * 0.35, col);
        }
      } else this.effects.endSkid(key);
      // dust off-road even without sliding
      if (w.contact && !onRoad && car.speed > 12 && near && !w.front && Math.random() < dt * 10) {
        const col = w.surf === SURF.grass ? 0x8aa865 : w.surf === SURF.sand ? 0xdcc592 : w.surf === SURF.ice ? 0xf2f8ff : 0xa88a62;
        this.effects.puff(new THREE.Vector3(w.px, w.py + 0.2, w.pz), car.vel.clone().multiplyScalar(0.15).add(new THREE.Vector3(0, 1, 0)), 0.5, col, 0.9);
      }
    }
    if (car.scrape > 4 && car.impact > 200 && near) {
      for (let k = 0; k < 3; k++) {
        const p = car.pos.clone().addScaledVector(car.left, (Math.random() < 0.5 ? 1 : -1) * 0.9).addScaledVector(car.fwd, (Math.random() - 0.5) * 3);
        this.effects.spark(p, car.vel.clone().multiplyScalar(0.6).add(new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6)));
      }
    }
  }

  // ---- HUD data -------------------------------------------------------------------
  hud() {
    const e = this.focus;
    const car = e?.car;
    const now = this.clock;
    this.messages = this.messages.filter((m) => m.until > now);
    return {
      state: this.state,
      time: this.time,
      countdown: this.state === 'countdown' ? Math.max(0, -this.time) : 0,
      speed: car ? car.speed : e ? e.vel.length() : 0,
      gear: car ? car.gear : 0,
      rpm: car ? car.rpm : 0,
      boost: car ? car.boost : 0,
      lap: e ? Math.min(e.race.lap + 1, this.laps) : 0,
      laps: this.laps,
      cp: e ? e.race.cpTimes.length : 0,
      cpTotal: e ? e.race.totalGates : 0,
      cpPerLap: this.track.checkpoints.length + 1,
      cpLap: e ? (this.laps ? Math.max(0, e.race.next) : e.race.cpTimes.length) : 0,
      place: e?.place || 1,
      racers: this.entries.filter((x) => x.kind !== 'ghost').length,
      wrongWay: car ? this._wrongWay(e) : false,
      messages: this.messages,
      finished: e?.race.finished,
      finishTime: e?.race.finishTime,
      respawns: e?.race.respawns || 0,
      offTrack: car && e.limits && !e.race.finished ? e.limits.left : null,
      name: e?.name,
    };
  }

  _wrongWay(e) {
    const sm = this.track.samples[e.prog.index];
    const v = e.car.vel;
    const along = v.x * sm.t.x + v.y * sm.t.y + v.z * sm.t.z;
    e.wrongT = along < -4 ? (e.wrongT || 0) + 1 / 60 : 0;
    return e.wrongT > 1.2;
  }

  takeEvents() { const ev = this.events; this.events = []; return ev; }

  ghostData() {
    if (!this.recorder || !this.player?.race.finished) return null;
    return this.recorder.encode({ time: this.player.race.finishTime, custom: this.player.custom, name: this.player.name });
  }

  dispose() {
    for (const e of this.entries) { this.renderer.scene.remove(e.model.group); e.model.dispose(); }
    this.entries = [];
    this.effects.dispose();
    this.view.dispose();
  }
}
