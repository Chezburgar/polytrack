// After the finish line: a handbrake slide to a stop - the nose swings out to
// one side and is held there while the car scrubs off its speed along the
// road. The tyres alone would spin the car or slide it off the road, so after
// each physics step the slide is steered (yaw held at the angle, drift across
// the road damped, speed bled off). The handbrake stays on for smoke and
// screech. Used for every car that finishes, player and bots alike.
import { clamp, smoothstep } from '../util/math.js';

const ANGLE = 1.2; // about 70 degrees

// fx = { t, side }: side +1 swings the nose left, -1 right. Before car.step.
export function finishDrift(car, fx, dt) {
  fx.t += dt;
  const inp = car.input;
  inp.hold = false;
  inp.analog = true;
  inp.throttle = 0;
  const sliding = car.speed > 2.5 && fx.t < 6;
  inp.handbrake = sliding ? 1 : 0;
  inp.steer = sliding ? fx.side : 0;
  inp.brake = sliding ? 0 : car.forwardSpeed > 0.5 ? 1 : 0;
}

// After car.step: sm is the road sample under the car ({ t, n, l }).
export function finishSettle(car, fx, dt, sm) {
  if (!car.grounded || fx.t > 6) return;
  const n = sm.n, t = sm.t, l = sm.l;
  // nose angle from the road direction, about the road normal (+ = left)
  const f = car.fwd;
  const ang = Math.atan2(f.dot(l), f.dot(t));
  const k = smoothstep(0, 0.45, fx.t);
  const want = fx.side * ANGLE * k;
  const rate = car.angVel.dot(n);
  // hold the angle while sliding; once stopped, stay put where it ended up
  const target = car.speed > 1.5 ? clamp((want - ang) * 5, -3.2, 3.2) : 0;
  car.angVel.addScaledVector(n, (target - rate) * (1 - Math.exp(-dt * 12)));
  // keep sliding down the road, not across it, and bleed the speed off
  const vl = car.vel.dot(l);
  car.vel.addScaledVector(l, -vl * (1 - Math.exp(-dt * 4)));
  const va = car.vel.dot(t);
  const decel = (4 + 6 * k) * dt;
  if (va > 0) car.vel.addScaledVector(t, -Math.min(va, decel));
}
