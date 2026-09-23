// Track limits shared by the live game and the headless validator, so a bot
// that passes the validator behaves the same way in a real race.
//
// Off the track (past the edge, or dropped below the road) a 3 second clock
// runs: get back on before it ends or you are put back on the road where you
// left it. Water, lava and falling out of the world put you back at once.
// There is no manual respawn - you drive back, or the clock does it for you.
import { frameAt } from '../track/geometry.js';
import { frameQuat } from './race.js';

export const OFF_TRACK_LIMIT = 3;
const EDGE_MARGIN = 2.5; // metres past the road edge before you count as off

export function isOffTrack(prog, track) {
  const sm = track.samples[prog.index];
  return Math.abs(prog.lat) > sm.hw + EDGE_MARGIN || prog.vert < -3;
}

// firmly on the road, upright: a safe place to come back to
function goodSpot(car, prog, sm) {
  return sm.road && car.groundedCount >= 3 && Math.abs(prog.lat) <= sm.hw - 0.5 && Math.abs(prog.vert) < 2 &&
    car.up.x * sm.n.x + car.up.y * sm.n.y + car.up.z * sm.n.z > 0.7;
}

// forward distance along the course from a to b (negative = behind)
function ahead(track, a, b) {
  let d = b - a;
  if (track.closed) {
    const L = track.length;
    d = ((d % L) + L) % L;
    if (d > L / 2) d -= L;
  }
  return d;
}

export class TrackLimits {
  constructor(track) {
    this.track = track;
    this.reset();
  }

  reset() {
    this.offTime = 0;
    this.leave = null; // where we last left the road
    this.good = null; // latest safe spot on the road
    this.flipTime = 0;
    this.stallAir = 0;
    this.odo = 0;
  }

  // seconds left on the off-track clock, or null while on the road
  get left() { return this.leave ? Math.max(0, OFF_TRACK_LIMIT - this.offTime) : null; }

  // Returns a reason to put the car back ('kill', 'fell', 'off', 'cut', 'flip',
  // 'stuck') or null.
  update(car, prog, dt) {
    const track = this.track;
    this.odo += car.speed * dt;
    if (car.onKill) return 'kill';
    if (car.pos.y < track.bounds.minY - 30) return 'fell';
    const sm = track.samples[prog.index];
    const off = isOffTrack(prog, track);
    if (!off && goodSpot(car, prog, sm)) {
      const g = this.good || (this.good = {});
      g.index = prog.index; g.s = prog.s; g.speed = car.forwardSpeed; g.odo = this.odo;
    }
    if (off) {
      if (!this.leave) {
        // put back at the last safe spot; judge shortcuts from where we left
        const g = this.good;
        this.leave = { index: g ? g.index : prog.index, speed: g ? g.speed : 0, s: prog.s, odo: this.odo };
      }
      this.offTime += dt;
      if (this.offTime >= OFF_TRACK_LIMIT) return 'off';
    } else if (this.leave) {
      // back on: fine, unless the detour skipped a big chunk of the course
      const gained = ahead(track, this.leave.s, prog.s);
      const driven = this.odo - this.leave.odo;
      if (gained > driven * 1.25 + 30) return 'cut';
      this.leave = null;
      this.offTime = 0;
    }
    // on its roof or side and going nowhere
    const upside = (car.up.y < 0.25 && car.speed < 3) || (car.up.y < -0.3 && car.speed < 6);
    this.flipTime = upside ? this.flipTime + dt : 0;
    if (this.flipTime > 1.4) return 'flip';
    // airborne far too long (wedged on a barrier, fell somewhere odd)
    this.stallAir = !car.grounded && car.speed < 2 ? this.stallAir + dt : 0;
    if (this.stallAir > 3) return 'stuck';
    return null;
  }

  // Where to put the car back for a given reason: { pos, quat, speed, index }.
  // speeds is the AI speed profile (a safe pace for every metre of road).
  placement(why, prog, speeds) {
    const track = this.track;
    let from, speed;
    if (why === 'flip' || why === 'stuck') { from = prog.index; speed = 0; }
    else {
      const src = this.leave || this.good || { index: prog.index, speed: 0 };
      from = src.index;
      speed = Math.min(Math.max(0, src.speed), speeds ? speeds[from] : 30) * 0.75;
      speed = Math.max(10, Math.min(42, speed));
    }
    return safePlacement(track, from, speed);
  }
}

// ---- safe places on the road -------------------------------------------------
// A stunt section runs from a kicker, gap or loop to a little past its landing.
// Nobody is put back inside one (you'd drop straight back off): they go to the
// far end of it instead. Just before one, you get enough speed to make it.
function stuntZones(track) {
  if (track._zones) return track._zones;
  const S = track.samples, n = S.length;
  const endOf = new Int32Array(n).fill(-1);
  const stunt = (sm) => sm.kind === 'K' || sm.kind === 'J' || sm.kind === 'LOOP' || !sm.road;
  const at = (i) => (track.closed ? ((i % n) + n) % n : Math.min(n - 1, Math.max(0, i)));
  for (let i = 0; i < n; i++) {
    if (!stunt(S[i]) || (i > 0 && stunt(S[i - 1]))) continue;
    let j = i;
    let guard = 0;
    while (stunt(S[at(j + 1)]) && guard++ < n) j++;
    const tail = S[at(j)].kind === 'LOOP' ? 12 : 30;
    const end = at(j + tail);
    for (let k = i; k <= j + tail; k++) endOf[at(k)] = end;
  }
  const soon = new Uint8Array(n); // within 90 m before a kicker or loop
  for (let i = 0; i < n; i++) {
    if ((S[i].kind !== 'K' && S[i].kind !== 'LOOP') || (i > 0 && S[i - 1].kind === S[i].kind)) continue;
    for (let d = 1; d <= 90; d++) {
      const j = track.closed ? at(i - d) : i - d;
      if (j < 0) break;
      soon[j] = 1;
    }
  }
  return (track._zones = { endOf, soon });
}

export function safePlacement(track, index, speed) {
  const z = stuntZones(track);
  let i = index;
  if (z.endOf[i] >= 0) { i = z.endOf[i]; speed = Math.max(speed, 22); }
  if (z.soon[i]) speed = Math.max(speed, 34);
  const f = frameAt(track, track.samples[i].s);
  const pos = f.p.clone().addScaledVector(f.n, 0.65);
  return { pos, quat: frameQuat(f.l, f.n, f.t), speed, index: i };
}

// Back on the road but clearly past the gate you still owe? Then a checkpoint
// was skipped (cut across the terrain, or fell round it) and the lap can't count.
// Distances are measured forward from the last gate crossed, never "the short
// way round" a circuit.
export function missedGate(race, prog, track) {
  if (race.finished) return false;
  const sm = track.samples[prog.index];
  if (!sm.road || Math.abs(prog.lat) > sm.hw + 1 || Math.abs(prog.vert) > 3) return false;
  const cps = race.cps;
  if (!track.closed) {
    if (race.next >= cps.length) return false;
    return prog.s > cps[race.next].s + 30;
  }
  if (race.next === -1) return false;
  const L = track.length;
  const mod = (x) => ((x % L) + L) % L;
  const last = race.next === 0 ? track.start : cps[race.next - 1];
  const next = race.next >= cps.length ? track.start : cps[race.next];
  const span = mod(next.s - last.s) || L;
  const fwd = mod(prog.s - last.s);
  if (fwd > L - 60) return false; // just behind the gate we last crossed
  return fwd > span + 30;
}
