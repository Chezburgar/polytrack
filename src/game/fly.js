// /fly: feathered wings unfold from the car and for 10 seconds it flies - a
// simple arcade flight model instead of the tyre physics: it holds a hover a few
// metres over whatever is below (under any roof above), turns on the steering
// with no grip to lose, speeds up on the throttle, and eases back into line with
// the road (and over it) whenever you let go of the wheel. In the last second it
// settles down to the road, the wings fold and the normal physics take over.
import * as THREE from 'three';
import { clamp, smoothstep } from '../util/math.js';

export const FLY_TIME = 10;
const HOVER = 4.5, MAX = 72, CRUISE = 48, SLOW = 18;
const hit = {};
const _e = new THREE.Euler();

// a flat, pointed feather lying along -z from its quill at the origin
function featherGeo(len, w) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(w / 2, len * 0.22);
  s.lineTo(w * 0.42, len * 0.8);
  s.lineTo(0, len);
  s.lineTo(-w * 0.42, len * 0.8);
  s.lineTo(-w / 2, len * 0.22);
  s.closePath();
  return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2);
}

// Two angel wings on shoulder pivots at the roof (rotation.z raises and flaps
// them): a bent arm, short coverts on top, secondaries along the inner arm and
// long primaries fanning out from the hand.
export function makeWings() {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide });
  const white = mat(0xfdfcf8), cream = mat(0xeee6d2), warm = mat(0xf6eedc);
  const gold = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd86a).multiplyScalar(1.8), side: THREE.DoubleSide });
  const feather = (parent, x, z, len, w, tilt, m, y) => {
    const f = new THREE.Mesh(featherGeo(len, w), m);
    f.position.set(x, y, z);
    f.rotation.y = tilt;
    parent.add(f);
    return f;
  };
  const wing = (side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.5, 0.2, 0.15);
    // the feathers hang down and back from the arm, so from behind (the chase
    // camera) you see the face of the wing, not its edge
    const plane = new THREE.Group();
    plane.rotation.x = -1.0;
    pivot.add(plane);
    const bone = (len) => { const b = new THREE.Mesh(new THREE.BoxGeometry(len, 0.13, 0.24), white); b.position.x = (side * len) / 2; return b; };
    plane.add(bone(1.1));
    // secondaries and coverts along the inner arm
    for (let i = 0; i < 5; i++) feather(plane, side * (0.12 + i * 0.22), 0.05, 0.85 + i * 0.06, 0.34, -side * (0.02 + i * 0.03), i % 2 ? warm : white, -0.02);
    for (let i = 0; i < 5; i++) feather(plane, side * (0.1 + i * 0.22), 0.1, 0.42, 0.3, -side * 0.05, cream, 0.035);
    // the hand, swept back, with the primaries fanning out from it
    const hand = new THREE.Group();
    hand.position.x = side * 1.05;
    hand.rotation.y = side * 0.3;
    hand.add(bone(1.15));
    for (let i = 0; i < 7; i++) {
      const len = 1.05 + i * 0.1;
      const f = feather(hand, side * (0.1 + i * 0.16), 0.04, len, 0.3, -side * (0.08 + i * 0.13), i % 2 ? white : warm, -0.03 - i * 0.004);
      if (i >= 4) { const tip = new THREE.Mesh(featherGeo(0.24, 0.16).translate(0, 0.006, 0.24 - len), gold); tip.position.copy(f.position); tip.rotation.y = f.rotation.y; hand.add(tip); } // gold tips
    }
    for (let i = 0; i < 4; i++) feather(hand, side * (0.12 + i * 0.26), 0.1, 0.36, 0.26, -side * 0.12, cream, 0.035);
    plane.add(hand);
    g.add(pivot);
    return pivot;
  };
  g.userData = { L: wing(1), R: wing(-1) };
  g.scale.setScalar(0.01);
  return g;
}

// open, flap, fold: u is the time since they appeared
export function animateWings(w, u) {
  const open = smoothstep(0, 0.5, u) * (1 - smoothstep(FLY_TIME - 0.4, FLY_TIME, u));
  w.scale.setScalar(Math.max(0.01, open * 1.25));
  const lift = 0.62 + Math.sin(u * 8) * 0.42 * open + (1 - open) * 0.7; // a raised V; folded up while opening and closing
  w.userData.L.rotation.z = lift;
  w.userData.R.rotation.z = -lift;
}

// One fixed step of flight for a car (its input already set by the driver or AI).
export function flyStep(car, f, sm, world, dt) {
  f.t += dt;
  const inp = car.input;
  // heading: the wheel turns it; hands off, it swings back to the road's line
  const steer = clamp(inp.steer || 0, -1, 1);
  f.yaw += steer * 1.7 * dt;
  if (Math.abs(steer) < 0.15 && sm && Math.abs(sm.t.y) < 0.6) {
    // along the road, drifting back over the middle of it
    const lat = (car.pos.x - sm.p.x) * sm.l.x + (car.pos.z - sm.p.z) * sm.l.z;
    const want = Math.atan2(sm.t.x, sm.t.z) - clamp(lat * 0.06, -0.4, 0.4);
    let d = want - f.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    f.yaw += d * Math.min(1, dt * 1.6);
  }
  // speed
  const target = inp.throttle > 0.1 ? MAX : inp.brake > 0.1 ? SLOW : CRUISE;
  f.speed += clamp(target - f.speed, -40 * dt, 22 * dt);
  // height: a hover above what's below, under any roof above
  const p = car.pos;
  let ground = sm ? sm.p.y - 3 : p.y - 6;
  if (world.raycast(p.x, p.y + 1, p.z, 0, -1, 0, 60, hit)) ground = Math.max(ground, hit.py);
  const land = smoothstep(FLY_TIME - 1.2, FLY_TIME - 0.2, f.t);
  let want = ground + (HOVER + Math.sin(f.t * 2.2) * 0.35) * (1 - land) + 0.7 * land;
  if (world.raycast(p.x, p.y + 0.5, p.z, 0, 1, 0, 9, hit)) want = Math.min(want, hit.py - 1.6);
  const rise = smoothstep(0, 0.6, f.t);
  const vy = clamp((want - p.y) * 3, -14, 14) * rise + (1 - rise) * 6;
  const fx = Math.sin(f.yaw), fz = Math.cos(f.yaw);
  car.vel.set(fx * f.speed, vy, fz * f.speed);
  p.addScaledVector(car.vel, dt);
  // pose: banked into turns, nose a touch up while climbing
  f.bank += (-steer * 0.45 - f.bank) * Math.min(1, dt * 5);
  car.quat.setFromEuler(_e.set(clamp(-vy * 0.03, -0.3, 0.3), f.yaw, f.bank, 'YXZ'));
  car.angVel.set(0, 0, 0);
  car.fwd.set(0, 0, 1).applyQuaternion(car.quat);
  car.up.set(0, 1, 0).applyQuaternion(car.quat);
  car.left.set(1, 0, 0).applyQuaternion(car.quat);
  car.speed = f.speed;
  car.forwardSpeed = f.speed;
  car.grounded = false;
  car.groundedCount = 0;
  car.airTime = 0;
  car.onKill = false;
  for (const w of car.wheels) { w.contact = false; w.slip = 0; w.slipLong = 0; w.load = 0; } // no dust or skids up here
  car.rpm = 3000 + f.speed * 60;
  car.gear = Math.min(6, 1 + Math.floor(f.speed / 14));
}
