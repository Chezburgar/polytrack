// One AI car races a track on the real physics under the live race rules
// (track limits, missed gates, boost pads). Runs a slice at a time, so the
// track editor can test a layout in the browser without freezing it; the
// headless validator (tools/sim.mjs) runs the same thing to completion.
import { Vector3 } from 'three';
import { loadTrack } from '../track/load.js';
import { Car } from '../physics/car.js';
import { AIDriver } from './ai.js';
import { Progress } from './progress.js';
import { RaceState } from './race.js';
import { TrackLimits, missedGate } from './rules.js';

const DT = 1 / 120;

export class Verifier {
  constructor(def, { skill = 1, seed = 1, maxTime = 400, trace = false, loaded = null } = {}) {
    const T0 = performance.now();
    const L = (this.loaded = loaded || loadTrack(def));
    this.loadMs = performance.now() - T0;
    this.def = def;
    this.track = L.track;
    this.speeds = L.speeds;
    this.race = new RaceState(this.track);
    this.car = new Car(L.world);
    this.car.reset(this.race.spawn.pos, this.race.spawn.quat);
    this.ai = new AIDriver(this.track, L.line, L.speeds, { skill, seed });
    this.prog = new Progress(this.track, this.track.start.index);
    this.prog.update(this.car.pos);
    this.limits = new TrackLimits(this.track);
    this.maxTime = maxTime;
    this.trace = trace;
    this.t = 0;
    this.prev = new Vector3();
    this.events = [];
    this.problems = []; // [{ why, s, piece, t }]
    this.respawns = 0;
    this.maxAir = 0;
    this.vmax = 0;
    this._lastTrace = 0;
  }

  get done() { return this.race.finished || this.t >= this.maxTime; }
  get progress() { return this.race.finished ? 1 : Math.max(0, Math.min(0.999, this.race.completion(this.prog.s ?? 0))); }

  // advance up to n physics steps; true once finished (or out of time)
  step(n = 600) {
    const { car, ai, prog, race, track, limits } = this;
    for (let k = 0; k < n && !this.done; k++) {
      this.prev.copy(car.pos);
      ai.drive(car, prog, DT);
      const rs = track.samples[prog.index];
      car.rampLeft = rs.kind === 'K' && rs.road ? rs.l : null;
      car.step(DT);
      this.t += DT;
      prog.update(car.pos);
      const sm = track.samples[prog.index];
      if (sm.boost && Math.abs(prog.vert) < 1.6 && Math.abs(prog.lat) < sm.hw - 1) car.boost = Math.max(car.boost, 1.35);
      const ev = race.cross(this.prev, car.pos, this.t, DT, car.forwardSpeed);
      if (ev) this.events.push(`${ev.kind}@${ev.time.toFixed(2)}`);
      this.vmax = Math.max(this.vmax, car.speed);
      this.maxAir = Math.max(this.maxAir, car.airTime);
      let why = null;
      if (ai.wantRespawn) { ai.wantRespawn = false; why = 'stuck'; }
      else why = limits.update(car, prog, DT) || (missedGate(race, prog, track) ? 'missed checkpoint' : null);
      if (why) this._respawn(why);
      if (car.nanReset) { this.problems.push({ why: 'NaN reset', s: prog.s, piece: sm.piece, t: this.t }); car.nanReset = false; }
      if (this.trace && this.t - this._lastTrace > 0.5) {
        this._lastTrace = this.t;
        console.log(`t=${this.t.toFixed(1)} s=${prog.s.toFixed(0)} v=${car.speed.toFixed(1)} vT=${this.speeds[prog.index].toFixed(1)} lat=${prog.lat.toFixed(1)} air=${car.grounded ? 0 : car.airTime.toFixed(2)} upY=${car.up.y.toFixed(2)} kind=${sm.kind}`);
      }
    }
    return this.done;
  }

  _respawn(why) {
    const { car, prog, track, race, limits } = this;
    this.respawns++;
    const sm = track.samples[prog.index];
    this.problems.push({ why, s: prog.s, piece: sm.piece, t: this.t });
    const r = why === 'missed checkpoint' ? race.respawn : limits.placement(why, prog, this.speeds);
    car.reset(r.pos, r.quat, r.speed || 0);
    limits.reset();
    prog.reset(r.index ?? track.start.index);
    prog.update(car.pos);
  }

  get result() {
    const track = this.track;
    return {
      id: this.def.id, finished: this.race.finished, time: this.race.finishTime, respawns: this.respawns,
      vmax: this.vmax, maxAir: this.maxAir, events: this.events,
      problems: this.problems.map((p) => `${p.why} at s=${p.s?.toFixed(0)} (piece ${p.piece}: "${track.pieces[p.piece]?.src}") t=${p.t.toFixed(1)}`),
      trouble: this.problems,
      length: track.length, samples: track.samples.length, tris: this.loaded.world.count, loadMs: this.loadMs, closure: track.closure,
    };
  }
}

// medal times from a clean AI run (same margins as tools/medals.mjs)
export function medalsFromTime(seconds) {
  const ms = seconds * 1000;
  const round = (v, step) => Math.round(v / step) * step;
  return { author: round(ms * 0.985, 10), gold: round(ms * 1.05, 100), silver: round(ms * 1.17, 100), bronze: round(ms * 1.35, 100) };
}
