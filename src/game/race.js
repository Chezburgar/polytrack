// Per-car race state: checkpoint order, laps, timing and respawn points. Used
// identically for the player, bots and the headless validator.
import { Vector3, Quaternion, Matrix4 } from 'three';
import { frameAt, gridSlot } from '../track/geometry.js';

const _m = new Matrix4();

export function frameQuat(l, n, t, out = new Quaternion()) {
  // body basis: X = left, Y = up, Z = forward
  _m.makeBasis(l, n, t);
  return out.setFromRotationMatrix(_m);
}

// Spawn transform for grid slot k (0 = pole).
export function gridSpawn(track, k) {
  const g = gridSlot(track, k);
  const f = frameAt(track, g.s);
  const pos = f.p.clone().addScaledVector(f.l, g.x).addScaledVector(f.n, 0.62);
  return { pos, quat: frameQuat(f.l, f.n, f.t), s: g.s };
}

export function gateSpawn(track, gate) {
  const f = frameAt(track, gate.s + 1.5);
  const pos = f.p.clone().addScaledVector(f.n, 0.65);
  return { pos, quat: frameQuat(f.l, f.n, f.t), s: gate.s + 1.5, index: f.index };
}

export class RaceState {
  constructor(track, { laps = track.laps, slot = 0 } = {}) {
    this.track = track;
    this.laps = track.closed ? Math.max(1, laps || 1) : 0;
    this.cps = track.checkpoints;
    this.spawn = gridSpawn(track, slot);
    this.reset();
  }

  reset() {
    this.next = this.track.closed ? -1 : 0; // -1: waiting to cross the start line (circuits)
    this.lap = 0;
    this.finished = false;
    this.finishTime = null;
    this.cpTimes = []; // race time at every checkpoint/lap crossing, in order
    this.lapTimes = [];
    this.lapStart = 0;
    this.respawn = { pos: this.spawn.pos.clone(), quat: this.spawn.quat.clone(), index: null, s: this.spawn.s, speed: 0 };
    this.respawns = 0;
    this.wrongWay = 0;
  }

  // total ordered gates in the race (for progress bars / splits)
  get totalGates() {
    return this.track.closed ? this.laps * (this.cps.length + 1) : this.cps.length + 1;
  }

  // Test the segment a->b (one physics step ending at time t, of length dt)
  // against the next gate. Returns an event or null.
  cross(a, b, t, dt, speed = 0) {
    if (this.finished) return null;
    const closed = this.track.closed;
    let gate, kind;
    if (closed) {
      if (this.next === -1 || this.next >= this.cps.length) { gate = this.track.start; kind = this.next === -1 ? 'arm' : 'lap'; }
      else { gate = this.cps[this.next]; kind = 'cp'; }
    } else if (this.next < this.cps.length) { gate = this.cps[this.next]; kind = 'cp'; }
    else { gate = this.track.finish; kind = 'finish'; }

    const d0 = (a.x - gate.p.x) * gate.t.x + (a.y - gate.p.y) * gate.t.y + (a.z - gate.p.z) * gate.t.z;
    const d1 = (b.x - gate.p.x) * gate.t.x + (b.y - gate.p.y) * gate.t.y + (b.z - gate.p.z) * gate.t.z;
    if (!(d0 < 0 && d1 >= 0)) return null;
    const f = d0 / (d0 - d1);
    const cx = a.x + (b.x - a.x) * f - gate.p.x, cy = a.y + (b.y - a.y) * f - gate.p.y, cz = a.z + (b.z - a.z) * f - gate.p.z;
    const lat = cx * gate.l.x + cy * gate.l.y + cz * gate.l.z;
    const up = cx * gate.n.x + cy * gate.n.y + cz * gate.n.z;
    if (Math.abs(lat) > gate.hw + 3.5 || up < -3 || up > 10) return null;
    const when = t - dt + f * dt;

    if (kind === 'arm') { this.next = 0; return { kind: 'arm', time: when }; }
    const sp = gateSpawn(this.track, gate);
    // like Trackmania: respawning keeps the speed you crossed the gate with
    this.respawn = { pos: sp.pos, quat: sp.quat, index: sp.index, s: sp.s, speed: Math.max(0, Math.min(speed, 70)) };
    this.cpTimes.push(when);
    if (kind === 'cp') {
      this.next++;
      return { kind: 'cp', time: when, index: this.cpTimes.length - 1 };
    }
    if (kind === 'lap') {
      this.lap++;
      this.lapTimes.push(when - this.lapStart);
      this.lapStart = when;
      if (this.lap >= this.laps) {
        this.finished = true;
        this.finishTime = when;
        return { kind: 'finish', time: when, lap: this.lap };
      }
      this.next = 0;
      return { kind: 'lap', time: when, lap: this.lap };
    }
    this.finished = true;
    this.finishTime = when;
    return { kind: 'finish', time: when };
  }

  // fraction of the race done (0..1) for live standings
  completion(progressS) {
    const L = this.track.length;
    if (this.finished) return 1 + 1e-6 * (1e7 - this.finishTime);
    if (this.track.closed) {
      let s = progressS - this.track.start.s;
      if (this.next === -1) s = Math.min(0, s > L / 2 ? s - L : s);
      else { s = ((s % L) + L) % L; if (this.next === 0 && s > L * 0.75) s -= L; }
      return (this.lap * L + s) / (this.laps * L);
    }
    return Math.max(0, progressS) / L;
  }
}
