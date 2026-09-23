// Respawn rules shared by the live game and the headless validator, so a bot
// that passes the validator behaves the same way in a real race.
const TERRAIN = new Set([4, 5]); // SURF.grass (also snow), SURF.sand

export function respawnReason(state, car, prog, track, dt, { patient = false } = {}) {
  if (car.onKill) return 'kill';
  // fell off an elevated section onto the ground below it: no way back up
  const under = car.grounded && TERRAIN.has(car.surface) && prog.vert < -2.5;
  state.underTime = under ? (state.underTime || 0) + dt : 0;
  if (state.underTime > 1.1) return 'fell';
  if (car.pos.y < track.bounds.minY - 30) return 'fell';
  const sm = track.samples[prog.index];
  const off = prog.dist > sm.hw + 18;
  state.offTime = off ? (state.offTime || 0) + dt : 0;
  if (state.offTime > (patient ? 4.5 : 2.5)) return 'off';
  // on its roof or side and going nowhere
  const upside = (car.up.y < 0.25 && car.speed < 3) || (car.up.y < -0.3 && car.speed < 6);
  state.flipTime = upside ? (state.flipTime || 0) + dt : 0;
  if (state.flipTime > 1.4) return 'flip';
  // airborne far too long (wedged on a barrier, fell somewhere odd)
  state.stallAir = !car.grounded && car.speed < 2 ? (state.stallAir || 0) + dt : 0;
  if (state.stallAir > 3) return 'stuck';
  return null;
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
