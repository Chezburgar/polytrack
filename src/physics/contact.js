// Car-to-car contact. Each car is a capsule along its length; touching cars
// get an impulse along the contact normal (kept mostly horizontal so nobody
// climbs over anybody), a little friction, and are pushed apart. The impulse is
// applied at the centre of mass height so a bump can nudge or turn a car but
// never roll it.
//
// Online, a remote car is an equal-mass body whose motion we only estimate:
// we push our own car away from it and its owner does the same on their side.
import { Vector3 } from 'three';

export const CAR_RADIUS = 0.98;
export const CAR_HALF = 1.28; // half the distance between the capsule's end centres
const RESTITUTION = 0.15;
const FRICTION = 0.25;
const SPIN = 0.45; // share of the yaw an off-centre hit would add

const _a0 = new Vector3(), _a1 = new Vector3(), _b0 = new Vector3(), _b1 = new Vector3();
const _ca = new Vector3(), _cb = new Vector3(), _n = new Vector3(), _p = new Vector3();
const _ra = new Vector3(), _rb = new Vector3(), _va = new Vector3(), _vb = new Vector3(), _t = new Vector3();
const _j = new Vector3(), _tmp = new Vector3();

// closest points between segments p1q1 and p2q2 (Ericson 5.1.9)
function closest(p1, q1, p2, q2, c1, c2) {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z;
  const d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z;
  const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s, t;
  const c = d1x * rx + d1y * ry + d1z * rz;
  const b = d1x * d2x + d1y * d2y + d1z * d2z;
  const den = a * e - b * b;
  s = den > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
  t = (b * s + f) / e;
  if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
  else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
  c1.set(p1.x + d1x * s, p1.y + d1y * s, p1.z + d1z * s);
  c2.set(p2.x + d2x * t, p2.y + d2y * t, p2.z + d2z * t);
}

// A body is { pos, vel, fwd, up, car } where car (a physics Car) is present
// for cars we simulate. Returns the impulse magnitude (0 = no contact).
export function collideCars(A, B) {
  const R = CAR_RADIUS;
  // quick reject
  const dx = A.pos.x - B.pos.x, dy = A.pos.y - B.pos.y, dz = A.pos.z - B.pos.z;
  const reach = 2 * (R + CAR_HALF);
  if (dx * dx + dy * dy + dz * dz > reach * reach) return 0;
  _a0.copy(A.pos).addScaledVector(A.fwd, -CAR_HALF); _a1.copy(A.pos).addScaledVector(A.fwd, CAR_HALF);
  _b0.copy(B.pos).addScaledVector(B.fwd, -CAR_HALF); _b1.copy(B.pos).addScaledVector(B.fwd, CAR_HALF);
  closest(_a0, _a1, _b0, _b1, _ca, _cb);
  _n.subVectors(_cb, _ca);
  let dist = _n.length();
  if (dist >= 2 * R) return 0;
  if (dist < 1e-4) { _n.copy(A.fwd).cross(A.up); dist = 0; } else _n.divideScalar(dist);
  // keep the push mostly horizontal relative to the road the cars are on
  const upk = _n.dot(A.up);
  _n.addScaledVector(A.up, -upk * 0.85);
  if (_n.lengthSq() < 1e-6) _n.copy(A.fwd).cross(A.up);
  _n.normalize();
  const depth = 2 * R - dist;
  _p.addVectors(_ca, _cb).multiplyScalar(0.5); // contact point
  // lever arms, flattened to centre-of-mass height (no roll from a bump)
  _ra.subVectors(_p, A.pos); _ra.addScaledVector(A.up, -_ra.dot(A.up));
  _rb.subVectors(_p, B.pos); _rb.addScaledVector(B.up, -_rb.dot(B.up));
  pointVel(A, _ra, _va);
  pointVel(B, _rb, _vb);
  const vn = _tmp.subVectors(_vb, _va).dot(_n); // < 0: closing
  // separate the capsules (half each; a remote car is moved by its owner)
  const push = depth * 0.5 + 0.005;
  if (A.car) A.car.pos.addScaledVector(_n, -push);
  if (B.car) B.car.pos.addScaledVector(_n, push);
  if (vn >= 0) return 0;
  const mA = A.car ? A.car.spec.mass : 1150, mB = B.car ? B.car.spec.mass : 1150;
  const kA = A.car ? angTerm(A.car, _ra, _n) * SPIN : 0;
  const kB = B.car ? angTerm(B.car, _rb, _n) * SPIN : 0;
  const j = (-(1 + RESTITUTION) * vn) / (1 / mA + 1 / mB + kA + kB);
  apply(A, _ra, _j.copy(_n).multiplyScalar(-j));
  apply(B, _rb, _j.copy(_n).multiplyScalar(j));
  // friction: rubbing side by side trades a little speed between the cars
  _t.subVectors(_vb, _va).addScaledVector(_n, -vn);
  const vt = _t.length();
  if (vt > 0.05) {
    const jt = Math.min(FRICTION * j, (vt / (1 / mA + 1 / mB)) * 0.5);
    _t.multiplyScalar(1 / vt);
    apply(A, _ra, _j.copy(_t).multiplyScalar(jt));
    apply(B, _rb, _j.copy(_t).multiplyScalar(-jt));
  }
  if (A.car) A.car.impact = Math.max(A.car.impact, j);
  if (B.car) B.car.impact = Math.max(B.car.impact, j);
  return j;
}

function pointVel(body, r, out) {
  out.copy(body.vel);
  if (body.car) out.add(_tmp.crossVectors(body.car.angVel, r).multiplyScalar(SPIN));
  return out;
}

// n . ((I^-1 (r x n)) x r) for a physics car
function angTerm(car, r, n) {
  const w = _tmp.crossVectors(r, n);
  car._applyInvI(w, w);
  return n.dot(w.cross(r));
}

function apply(body, r, J) {
  const car = body.car;
  if (!car) return;
  const m = car.spec.mass;
  car.vel.addScaledVector(J, 1 / m);
  const w = _tmp.crossVectors(r, J);
  car._applyInvI(w, w);
  car.angVel.addScaledVector(w, SPIN);
}
