// Respawn rules shared by the live game and the headless validator, so a bot
// that passes the validator behaves the same way in a real race.
export function respawnReason(state, car, prog, track, dt, { patient = false } = {}) {
  if (car.onKill) return 'kill';
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
