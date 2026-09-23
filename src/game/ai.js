// AI driver: a precomputed racing line and speed profile per track, followed by
// pure-pursuit steering. Bots drive the exact same physics as the player, which
// also makes them the automated proof that every track can be completed.
import { Vector3 } from 'three';
import { clamp } from '../util/math.js';
import { SURFACE, CAR_SPEC } from '../physics/car.js';

const WB = 2.64;

// Offsets from the centreline (+ left) that shorten and straighten the path.
export function computeRacingLine(track, margin = 1.9) {
  const S = track.samples;
  const n = S.length;
  const closed = track.closed;
  const off = new Float64Array(n);
  const lim = new Float64Array(n);
  const free = new Uint8Array(n);
  // lock the line to the centre on stunts and near their ends
  const locked = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const k = S[i].kind;
    if (k === 'LOOP' || k === 'J' || k === 'K' || !S[i].road) {
      // stay central on stunts, and for a good stretch after a landing
      const after = k === 'J' || !S[i].road ? 48 : 14;
      const before = k === 'K' || k === 'LOOP' ? 45 : 14; // line up early for take-off
      for (let d = -before; d <= after; d++) {
        let j = i + d;
        if (closed) j = (j + n) % n; else if (j < 0 || j >= n) continue;
        locked[j] = 1;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    lim[i] = Math.max(0, S[i].hw - margin);
    free[i] = locked[i] ? 0 : 1;
  }
  const idx = (i) => (closed ? (i + n) % n : clamp(i, 0, n - 1));
  const px = new Float64Array(n), py = new Float64Array(n), pz = new Float64Array(n);
  const place = (i) => {
    const s = S[i];
    px[i] = s.p.x + s.l.x * off[i]; py[i] = s.p.y + s.l.y * off[i]; pz[i] = s.p.z + s.l.z * off[i];
  };
  for (let i = 0; i < n; i++) place(i);
  for (const k of [40, 28, 20, 14, 10, 7, 5, 3]) {
    for (let it = 0; it < 30; it++) {
      for (let i = 0; i < n; i++) {
        if (!free[i]) continue;
        const a = idx(i - k), b = idx(i + k);
        if (!closed && (i - k < 0 || i + k >= n)) continue;
        const mx = (px[a] + px[b]) / 2, my = (py[a] + py[b]) / 2, mz = (pz[a] + pz[b]) / 2;
        const s = S[i];
        const o = (mx - s.p.x) * s.l.x + (my - s.p.y) * s.l.y + (mz - s.p.z) * s.l.z;
        off[i] = clamp(off[i] + (o - off[i]) * 0.55, -lim[i], lim[i]);
        place(i);
      }
    }
  }
  return off;
}

// Target speed at every sample from curvature, surface grip and braking distance.
export function computeSpeedProfile(track, line, { grip = 1, vmax = 90 } = {}) {
  const S = track.samples;
  const n = S.length;
  const closed = track.closed;
  const spec = CAR_SPEC;
  const g = spec.gravity;
  const pos = (i) => {
    const s = S[i];
    return new Vector3(s.p.x + s.l.x * line[i], s.p.y + s.l.y * line[i], s.p.z + s.l.z * line[i]);
  };
  const P = [];
  for (let i = 0; i < n; i++) P.push(pos(i));
  const at = (i) => P[closed ? (i + n) % n : clamp(i, 0, n - 1)];
  const v = new Float64Array(n);
  const K = 5;
  for (let i = 0; i < n; i++) {
    const s = S[i];
    if (s.kind === 'LOOP' || !s.road || s.kind === 'K') { v[i] = vmax; continue; }
    const a = at(i - K), b = at(i), c = at(i + K);
    // horizontal curvature from the turn angle between the two chords
    const d1x = b.x - a.x, d1z = b.z - a.z, d2x = c.x - b.x, d2z = c.z - b.z;
    const l1 = Math.hypot(d1x, d1z), l2 = Math.hypot(d2x, d2z);
    let kap = 0;
    if (l1 > 0.2 && l2 > 0.2) {
      const cr = (d1x * d2z - d1z * d2x) / (l1 * l2);
      const dt = (d1x * d2x + d1z * d2z) / (l1 * l2);
      kap = Math.abs(Math.atan2(cr, dt)) / ((l1 + l2) / 2);
    }
    const surf = SURFACE[s.surf] || SURFACE[0];
    const mu = spec.mu * surf.grip * grip * 0.9;
    const bankBoost = Math.max(0, Math.abs(Math.sin(s.bank))) * g * 0.8;
    // include downforce: v^2 k = mu (g + Cd v^2 / m) + bank  ->  v^2 (k - mu Cd/m) = mu g + bank
    const dfk = (mu * spec.downforce) / spec.mass;
    const denom = kap - dfk;
    v[i] = denom <= 1e-6 ? vmax : Math.min(vmax, Math.sqrt((mu * g + bankBoost) / denom));
    // crest: don't take off over a hump (unless it's the run into a kicker)
    const a3 = S[closed ? (i - 6 + n) % n : Math.max(0, i - 6)], c3 = S[closed ? (i + 6) % n : Math.min(n - 1, i + 6)];
    const kv = (a3.t.y - c3.t.y) / Math.max(1, c3.s - a3.s); // + when the road tips over a crest
    if (kv > 0.004 && s.n.y > 0.8) v[i] = Math.min(v[i], Math.sqrt((g * 1.25) / kv));
  }
  // braking pass (backwards), twice round for circuits
  const brake = (i) => {
    const surf = SURFACE[S[i].surf] || SURFACE[0];
    return 13.5 * Math.min(1, surf.grip + 0.1) * grip;
  };
  // Jumps and loops break the braking chain: you can't brake in the air, and
  // arriving slow is what makes you fall short - so bots commit to them flat
  // out and brake after landing instead.
  const commit = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const k = S[i].kind;
    if (k === 'K' || k === 'J' || k === 'LOOP' || !S[i].road) {
      for (let d = 0; d <= 3; d++) { const j = closed ? (i + d) % n : Math.min(n - 1, i + d); commit[j] = 1; }
    }
  }
  const passes = closed ? 2 : 1;
  for (let p = 0; p < passes; p++) {
    for (let k = n - 2 + (closed ? 1 : 0); k >= 0; k--) {
      const i = k % n, j = (k + 1) % n;
      if (!closed && j >= n) continue;
      if (commit[i]) { v[i] = vmax; continue; }
      const ds = Math.max(0.1, P[i].distanceTo(P[j]));
      v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * brake(i) * ds));
    }
  }
  // no dawdling into a kicker or loop: hold a floor speed on the run-up
  for (let i = 0; i < n; i++) {
    const k = S[i].kind;
    if (k !== 'K' && k !== 'LOOP') continue;
    for (let d = 1; d <= 60; d++) {
      const j = closed ? (i - d + n) % n : i - d;
      if (j < 0 || S[j].kind === 'K' || S[j].kind === 'LOOP') break;
      v[j] = Math.max(v[j], Math.min(34, v[j] + (60 - d) * 0.5));
    }
  }
  return v;
}

export class AIDriver {
  constructor(track, line, speeds, { skill = 1, seed = 1 } = {}) {
    this.track = track;
    this.line = line;
    this.speeds = speeds;
    this.skill = skill;
    this.jitter = ((seed * 9301 + 49297) % 233280) / 233280 - 0.5; // lateral personality
    this.stuck = 0;
    this.wantRespawn = false;
    this.reverseTime = 0;
    this.S = track.samples;
    this.traffic = null; // [{ s, lat, v }] of the other cars, set by the session
    this.dodge = 0; // lateral shift off the racing line to get round someone
    this.capSpeed = Infinity;
    this.noPass = noPassZones(track);
    this.lane = 0; // grid lane held for the first seconds, then merged away
    this.laneT = 0;
  }

  // start in the lane of your grid slot instead of everyone diving for the line
  startLane(lat, prog) {
    const i = prog.index;
    this.lane = lat - (this.line[i] + this.jitter * Math.min(1.2, this.S[i].hw * 0.12));
    this.dodge = this.lane;
    this.laneT = 5;
  }

  // Cars ahead in our lane that we're catching: move over to the side with
  // room, or ease off and queue if there isn't any. Alongside: keep our side.
  // Never near a kicker, jump or loop - there you hold the centre line.
  _avoid(prog, v, dt) {
    const S = this.S, i = prog.index, T = this.traffic;
    const closed = this.track.closed, L = this.track.length;
    const base = this.line[i] + this.jitter * Math.min(1.2, S[i].hw * 0.12);
    const lim = Math.max(0, S[i].hw - 1.6);
    let want = 0, cap = Infinity;
    if (this.laneT > 0) { this.laneT -= dt; want = this.lane * Math.min(1, this.laneT / 3); }
    if (T && T.length) {
      for (const o of T) {
        let ds = o.s - prog.s;
        if (closed) { ds = ((ds % L) + L) % L; if (ds > L / 2) ds -= L; }
        if (ds < -7 || ds > 35) continue;
        const dl = o.lat - prog.lat;
        if (Math.abs(dl) > 3.4) continue;
        if (ds > 2.5) {
          const closing = v - o.v;
          if (ds > 12 && (closing <= 0 || (ds - 6) / closing > 2)) continue;
          const roomL = lim - o.lat, roomR = o.lat + lim;
          const side = roomL >= roomR ? 1 : -1;
          if (!this.noPass[i] && (side > 0 ? roomL : roomR) > 2.6) want = o.lat + side * 3.1 - base;
          else cap = Math.min(cap, Math.max(4, o.v - 1 + (ds - 7) * 0.5));
        } else if (!this.noPass[i]) {
          want += (dl > 0 ? -1 : 1) * (3.4 - Math.abs(dl)) * 0.7;
        }
      }
    }
    // on a stunt's run-up nobody slows for traffic: arriving slow is what
    // drops you in the gap or off the top of the loop
    if (this.noPass[i]) { want = 0; cap = Infinity; }
    want = clamp(want, -lim - base, lim - base);
    const rate = 2.5 * dt;
    this.dodge += clamp(want - this.dodge, -rate, rate);
    this.capSpeed = cap;
  }

  // step the ballistic arc until it meets the road surface; returns a sample index
  predictLanding(car, i) {
    const S = this.S;
    const g = car.spec.gravity;
    let k = i;
    for (let t = 0.1; t < 4; t += 0.1) {
      const px = car.pos.x + car.vel.x * t, py = car.pos.y + car.vel.y * t - 0.5 * g * t * t, pz = car.pos.z + car.vel.z * t;
      // walk forward along the course to the sample nearest this point
      let best = k, bd = Infinity;
      for (let d = 0; d < 60; d++) {
        const j = this.aheadIndex(k, d);
        const sm = S[j];
        const dx = sm.p.x - px, dz = sm.p.z - pz;
        const dd = dx * dx + dz * dz;
        if (dd < bd) { bd = dd; best = j; }
      }
      k = best;
      if (S[k].road && py <= S[k].p.y + 1.2) return k;
    }
    return k;
  }

  linePoint(i, out) {
    const S = this.track.samples;
    const s = S[i];
    const lim = Math.max(0, s.hw - 1.4);
    const o = clamp(this.line[i] + this.jitter * Math.min(1.2, s.hw * 0.12) + this.dodge, -lim, lim);
    return out.set(s.p.x + s.l.x * o, s.p.y + s.l.y * o, s.p.z + s.l.z * o);
  }

  // look ahead by distance along the samples (1 m spacing)
  aheadIndex(i, d) {
    const n = this.track.samples.length;
    const k = i + Math.round(d);
    return this.track.closed ? ((k % n) + n) % n : Math.min(n - 1, Math.max(0, k));
  }

  drive(car, progress, dt) {
    const inp = car.input;
    inp.handbrake = 0;
    inp.analog = true;
    const v = car.forwardSpeed;
    const i = progress.index;

    // airborne: the car's air assist levels it for the landing; steer the nose
    // round to the road we'll come down on, in case it curves away
    if (!car.grounded && car.airTime > 0.05) {
      const land = this.S[this.predictLanding(car, i)];
      _c.crossVectors(car.fwd, land.t);
      inp.steer = clamp(_c.dot(car.up) * 3, -1, 1);
      inp.throttle = 0; inp.brake = 0;
      return;
    }

    this._avoid(progress, v, dt);

    // stuck or facing the wrong way -> reverse out, then give up and respawn
    if (Math.abs(v) < 1.5) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt * 2);
    if (this.reverseTime > 0) {
      this.reverseTime -= dt;
      inp.throttle = 0; inp.brake = 1; inp.steer = 0;
      return;
    }
    if (this.stuck > 2.5) { this.stuck = 0; this.reverseTime = 1.0; this.fails = (this.fails || 0) + 1; }
    if ((this.fails || 0) >= 2) { this.wantRespawn = true; this.fails = 0; }

    // Stanley steering at the front axle: heading error + cross-track error,
    // plus curvature feed-forward (with a little preview) and yaw damping.
    const S = this.track.samples;
    const spd = Math.max(Math.abs(v), 1);
    const j = this.aheadIndex(i, 1.3);
    const road = S[j];
    const pa = this.linePoint(this.aheadIndex(j, -2), _a);
    const pb = this.linePoint(this.aheadIndex(j, 2), _b);
    _t.subVectors(pb, pa).normalize();
    // heading error about the road normal
    const n = road.n;
    const fdn = car.fwd.dot(n);
    _f.copy(car.fwd).addScaledVector(n, -fdn).normalize();
    _c.crossVectors(_f, _t);
    const headErr = Math.atan2(_c.dot(n), _f.dot(_t));
    // cross-track error of the front axle (+ = left of the line)
    const lp = this.linePoint(j, _p);
    const cte = (car.pos.x + car.fwd.x * 1.34 - lp.x) * road.l.x + (car.pos.y + car.fwd.y * 1.34 - lp.y) * road.l.y + (car.pos.z + car.fwd.z * 1.34 - lp.z) * road.l.z;
    // signed curvature of the line a short preview ahead
    const pre = Math.max(2, spd * 0.22);
    const c0 = this.linePoint(this.aheadIndex(j, pre - 5), _a), c1 = this.linePoint(this.aheadIndex(j, pre), _b), c2 = this.linePoint(this.aheadIndex(j, pre + 5), _p);
    // curvature in the road's own plane (so loops and banks read correctly):
    // change of the unit tangent, projected on the road's left vector
    _d.subVectors(c1, c0); const l1 = _d.length() || 1; _d.divideScalar(l1);
    _c.subVectors(c2, c1); const l2 = _c.length() || 1; _c.divideScalar(l2);
    const kap = (_c.sub(_d).dot(road.l)) / Math.max(1, (l1 + l2) / 2);
    const yawRate = car.angVel.dot(car.up);
    let delta = headErr + Math.atan2(-2.2 * cte, spd + 4) + Math.atan(WB * kap) - 0.05 * (yawRate - spd * kap);
    const spec = car.spec;
    const steerMax = spec.minSteer + (spec.maxSteer - spec.minSteer) / (1 + (Math.abs(v) / spec.steerFalloff) ** 2);
    inp.steer = clamp(delta / steerMax, -1, 1);
    const z = _t.dot(car.fwd), x = -cte;
    const dist = Math.abs(cte) + 5;

    // speed
    const si = this.aheadIndex(i, Math.max(3, Math.abs(v) * 0.3));
    const vT = Math.min(this.speeds[si] * this.skill, this.capSpeed);
    if (v < vT - 0.8) { inp.throttle = 1; inp.brake = 0; }
    else if (v > vT + 1.2) { inp.throttle = 0; inp.brake = clamp((v - vT) / 5, 0.25, 1); }
    else { inp.throttle = 0.45; inp.brake = 0; }
    // pointing well away from the line (after a spin): slow down and turn in
    if (z < 0 && dist > 3) { inp.throttle = 0.4; inp.brake = 0; inp.steer = x > 0 ? 1 : -1; }
  }
}
const _t = new Vector3(), _d = new Vector3(), _a = new Vector3(), _b = new Vector3(), _p = new Vector3(), _c = new Vector3(), _f = new Vector3();

// Where overtaking is off: kickers, gaps and loops, the 80 m run-up to a
// kicker or loop, and 40 m past a landing or a loop exit.
function noPassZones(track) {
  if (track._noPass) return track._noPass;
  const S = track.samples, n = S.length;
  const out = new Uint8Array(n);
  const at = (j) => (track.closed ? ((j % n) + n) % n : j);
  for (let i = 0; i < n; i++) {
    const k = S[i].kind;
    if (k !== 'K' && k !== 'J' && k !== 'LOOP' && S[i].road) continue;
    const before = k === 'K' || k === 'LOOP' ? 80 : 0, after = k === 'J' || k === 'LOOP' || !S[i].road ? 40 : 0;
    for (let d = -before; d <= after; d++) { const j = at(i + d); if (j >= 0 && j < n) out[j] = 1; }
  }
  return (track._noPass = out);
}
