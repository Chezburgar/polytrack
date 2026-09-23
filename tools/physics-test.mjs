// Headless handling checks on a flat plane: settle, launch, top speed, braking,
// steady-state cornering, handbrake rotation. Prints numbers to tune against.
import { Vector3, Quaternion } from 'three';
import { CollisionWorld } from '../src/physics/world.js';
import { Car } from '../src/physics/car.js';
import { SURF } from '../src/track/builder.js';

const world = new CollisionWorld();
// one big flat asphalt quad so wheels hit real triangles
const S = 3000;
world.addTri(-S, 0, -S, S, 0, S, S, 0, -S, SURF.asphalt);
world.addTri(-S, 0, -S, -S, 0, S, S, 0, S, SURF.asphalt);
world.build(64);
const dt = 1 / 120;
const car = new Car(world);
const fresh = () => { car.reset(new Vector3(0, 0.62, 0), new Quaternion()); car.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0 }; };

fresh();
for (let i = 0; i < 240; i++) car.step(dt);
console.log('settle: y=%s comp=%s grounded=%d vel=%s', car.pos.y.toFixed(3), car.wheels.map(w => w.comp.toFixed(3)).join(','), car.groundedCount, car.vel.length().toFixed(4));

// launch
car.input.throttle = 1;
let t = 0, t100 = null, t200 = null;
for (let i = 0; i < 120 * 40; i++) {
  car.step(dt); t += dt;
  const kmh = car.forwardSpeed * 3.6;
  if (t100 == null && kmh >= 100) t100 = t;
  if (t200 == null && kmh >= 200) t200 = t;
}
console.log('0-100 %ss  0-200 %ss  top %s km/h  pitch-up %s  y=%s', t100?.toFixed(2), t200?.toFixed(2), (car.forwardSpeed * 3.6).toFixed(1), car.fwd.y.toFixed(3), car.pos.y.toFixed(3));

// braking from 100
fresh();
car.input.throttle = 1;
while (car.forwardSpeed < 27.78) car.step(dt);
car.input.throttle = 0; car.input.brake = 1;
const p0 = car.pos.clone(); t = 0;
while (car.forwardSpeed > 0.3 && t < 10) { car.step(dt); t += dt; }
console.log('brake 100-0: %s m in %ss', car.pos.distanceTo(p0).toFixed(1), t.toFixed(2));

// steady-state cornering: full steer at fixed speeds, measure radius + lateral g
for (const target of [15, 25, 35, 45, 55]) {
  fresh();
  car.input.throttle = 1;
  while (car.forwardSpeed < target) car.step(dt);
  car.input.steer = 1;
  let yawRate = 0, n = 0, slip = 0;
  for (let i = 0; i < 120 * 4; i++) {
    // hold speed with a simple controller
    car.input.throttle = car.forwardSpeed < target ? 1 : 0;
    car.input.brake = car.forwardSpeed > target + 1 ? 0.3 : 0;
    car.step(dt);
    if (i > 240) { yawRate += car.angVel.y; n++; slip += Math.atan2(car.vel.dot(car.left), car.vel.dot(car.fwd)); }
  }
  yawRate /= n; slip /= n;
  const v = car.speed;
  const R = v / Math.abs(yawRate);
  console.log('full-lock @%s m/s: R=%s m  lat=%s g  beta=%s deg  roll=%s  upY=%s', target, R.toFixed(1), (v * v / R / 11).toFixed(2), (slip * 57.3).toFixed(1), (Math.asin(car.left.y) * 57.3).toFixed(1), car.up.y.toFixed(3));
}

// handbrake turn at 30 m/s
fresh();
car.input.throttle = 1;
while (car.forwardSpeed < 30) car.step(dt);
car.input.throttle = 0.3; car.input.steer = 1; car.input.handbrake = 1;
let maxYaw = 0;
for (let i = 0; i < 60; i++) { car.step(dt); maxYaw = Math.max(maxYaw, Math.abs(car.angVel.y)); }
car.input.handbrake = 0; car.input.throttle = 1; car.input.steer = 0;
for (let i = 0; i < 240; i++) car.step(dt);
console.log('handbrake: peak yaw %s rad/s, after recovery yawRate=%s speed=%s upY=%s', maxYaw.toFixed(2), car.angVel.y.toFixed(3), car.speed.toFixed(1), car.up.y.toFixed(3));

// perf
fresh(); car.input.throttle = 1; car.input.steer = 0.4;
const t0 = performance.now();
for (let i = 0; i < 12000; i++) car.step(dt);
console.log('perf: %s us per step', ((performance.now() - t0) / 12000 * 1000).toFixed(1));
