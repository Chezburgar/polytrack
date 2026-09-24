// Rigid-body car on four raycast wheels. Every car in PolyTrack Pro shares this one
// handling model, so a race is decided by driving, not by the garage.
//
// Body frame: +X left, +Y up, +Z forward (right-handed). Positions are the
// centre of mass. Runs in Node (headless sims, AI validation) and the browser.
import { Vector3, Quaternion, Matrix4 } from 'three';
import { clamp, lerp } from '../util/math.js';
import { SURF } from '../track/builder.js';

export const CAR_SPEC = {
  mass: 1150,
  inertia: [1700, 2000, 620], // pitch (X), yaw (Y), roll (Z)
  gravity: 11.0,
  wheelRadius: 0.36,
  wheels: [
    { x: 0.84, z: 1.34, front: true, drive: 0.2 },
    { x: -0.84, z: 1.34, front: true, drive: 0.2 },
    { x: 0.84, z: -1.3, front: false, drive: 0.3 },
    { x: -0.84, z: -1.3, front: false, drive: 0.3 },
  ],
  mountY: 0.1,
  restLen: 0.4,
  maxComp: 0.27,
  springK: 36000,
  damperC: 3600,
  reboundC: 2600,
  bumpK: 260000,
  antiRoll: 12000,
  rollCenter: 0.46,
  mu: 1.6,
  latSat: 0.55,
  latSatSpeed: 0.07,
  slideFalloff: 0.1,
  enginePower: 430000,
  engineForceMax: 12500,
  brakeForce: 17500,
  reverseForce: 6000,
  reverseMax: 13,
  dragC: 0.92,
  downforce: 1.6,
  rollResist: 22,
  maxSteer: 0.5,
  minSteer: 0.075,
  steerFalloff: 30,
  handbrakeGrip: 0.45,
  yawAssist: 6,
  slipAssist: 9,
  maxYaw: 2.3,
  assistMax: 9,
  // In the air the car eases itself toward its flight path and the predicted
  // landing surface. Inputs only bias that target (radians / rad per second),
  // so holding accelerate over a long jump never flips the car.
  airAssist: 4.5,
  airMaxRate: 3.2,
  airNoseUp: 0.4,
  airNoseDown: 0.1,
  airYawRate: 1.3,
  airYawMax: 0.55,
  // tyre grip stops growing past this load (N per wheel): a kicker or a hard
  // landing briefly loads the tyres 4x, which made a steering tap on a ramp
  // throw the car sideways far harder than the same tap on flat road
  gripLoadCap: 6800,
  // on a kicker ramp (the race tells the car via rampLeft): steering is
  // softened and drift across the ramp damped, so jumps launch straight
  rampSteer: 0.35,
  rampDamp: 3.5,
  boostAccel: 14,
  bodyRadius: 0.46,
  bodySpheres: [
    [0.5, 0.14, 1.5], [-0.5, 0.14, 1.5], [0.5, 0.14, 0], [-0.5, 0.14, 0], [0.5, 0.14, -1.5], [-0.5, 0.14, -1.5],
  ],
  gears: [0, 13, 22, 31, 41, 53, 70], // top speed per gear (m/s), cosmetic: sound + HUD
};

// surface grip and drag multipliers
export const SURFACE = {
  [SURF.asphalt]: { grip: 1.0, drag: 0 },
  [SURF.line]: { grip: 0.97, drag: 0 },
  [SURF.dirt]: { grip: 0.72, drag: 12 },
  [SURF.ice]: { grip: 0.26, drag: 0 },
  [SURF.grass]: { grip: 0.62, drag: 90 },
  [SURF.sand]: { grip: 0.55, drag: 130 },
  [SURF.wall]: { grip: 0.8, drag: 0 },
  [SURF.boost]: { grip: 1.0, drag: 0 },
  [SURF.kill]: { grip: 0.5, drag: 200 },
  [SURF.structure]: { grip: 0.85, drag: 20 },
};

const _hit = { t: 0, px: 0, py: 0, pz: 0, nx: 0, ny: 1, nz: 0, mat: 0, tri: -1 };
const _contacts = [];
const _v = new Vector3(), _r = new Vector3(), _f = new Vector3(), _t = new Vector3(), _tmp = new Vector3(), _tmp2 = new Vector3();
const _tmp3 = new Vector3(), _ang = new Vector3();
const _q = new Quaternion(), _qi = new Quaternion(), _qt = new Quaternion(), _qe = new Quaternion();
const _U = new Vector3(), _F = new Vector3(), _Lv = new Vector3(), _m4 = new Matrix4();
const WORLD_UP = new Vector3(0, 1, 0);

export class Car {
  constructor(world, spec = CAR_SPEC) {
    this.world = world;
    this.spec = spec;
    this.pos = new Vector3();
    this.vel = new Vector3();
    this.quat = new Quaternion();
    this.angVel = new Vector3();
    this.fwd = new Vector3(0, 0, 1);
    this.up = new Vector3(0, 1, 0);
    this.left = new Vector3(1, 0, 0);
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    this.steer = 0; // smoothed steer input -1..1 (+ left)
    this.rearGrip = 1;
    this.boost = 0;
    this.invI = spec.inertia.map((v) => 1 / v);
    this.wheels = spec.wheels.map((w) => ({
      ...w, comp: 0, contact: false, load: 0, spin: 0, spinVel: 0, steerAngle: 0, slip: 0, slipLong: 0,
      surf: SURF.asphalt, px: 0, py: 0, pz: 0, nx: 0, ny: 1, nz: 0,
    }));
    this.grounded = false;
    this.groundedCount = 0;
    this.airTime = 0;
    this.speed = 0;
    this.forwardSpeed = 0;
    this.gear = 1;
    this.rpm = 900;
    this.impact = 0; // strongest contact impulse this step (N*s), for sound + shake
    this.scrape = 0;
    this.landing = 0;
    this.onKill = false;
    this.surface = SURF.asphalt;
    this.landN = null; // predicted landing surface normal while airborne
    this._landVec = new Vector3();
    this.airYawOff = 0;
    this.rampLeft = null; // the ramp's sideways direction while on a kicker (set by the race)
    this.updateBasis();
  }

  reset(pos, quat, speed = 0) {
    this.pos.copy(pos);
    this.quat.copy(quat).normalize();
    this.updateBasis();
    this.vel.copy(this.fwd).multiplyScalar(speed);
    this.angVel.set(0, 0, 0);
    this.steer = 0;
    this.rearGrip = 1;
    this.boost = 0;
    this.airTime = 0;
    this.airYawOff = 0;
    this.landN = null;
    this._landT = 0;
    this.speed = Math.abs(speed);
    this.forwardSpeed = speed;
    this.gear = 1;
    this.rpm = 900;
    for (const w of this.wheels) { w.comp = 0.09; w.contact = false; w.spinVel = 0; w.slip = 0; w.slipLong = 0; }
  }

  updateBasis() {
    this.fwd.set(0, 0, 1).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.left.set(1, 0, 0).applyQuaternion(this.quat);
  }

  // world-space vector -> apply inverse inertia (body diagonal) -> world
  _applyInvI(vec, out) {
    _qi.copy(this.quat).invert();
    out.copy(vec).applyQuaternion(_qi);
    out.x *= this.invI[0]; out.y *= this.invI[1]; out.z *= this.invI[2];
    return out.applyQuaternion(this.quat);
  }

  step(dt, substeps = 2) {
    const h = dt / substeps;
    this.impact = 0;
    this.scrape = 0;
    this.landing = 0;
    this._smoothInputs(dt);
    // braking cancels a boost pad's push, so a pad before a corner is never a trap
    if (this.boost > 0 && this.input.brake > 0.3 && this.forwardSpeed > 2) this.boost = 0;
    for (let i = 0; i < substeps; i++) this._substep(h);
    this.speed = this.vel.length();
    this.forwardSpeed = this.vel.dot(this.fwd);
    if (this.boost > 0) this.boost = Math.max(0, this.boost - dt);
    this.airTime = this.grounded ? 0 : this.airTime + dt;
    this._gearbox(dt);
    // visual wheel spin
    for (const w of this.wheels) {
      w.spin = (w.spin + w.spinVel * dt) % (Math.PI * 2);
    }
    // safety net: a NaN or runaway state never survives a step
    if (!isFinite(this.pos.x + this.pos.y + this.pos.z + this.vel.x + this.vel.y + this.vel.z + this.angVel.x + this.angVel.y + this.angVel.z)) {
      this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0);
      if (!isFinite(this.pos.x + this.pos.y + this.pos.z)) this.pos.set(0, 5, 0);
      this.quat.identity();
      this.nanReset = true;
    }
    if (this.speed > 160) this.vel.multiplyScalar(160 / this.speed);
    const w2 = this.angVel.length();
    if (w2 > 18) this.angVel.multiplyScalar(18 / w2);
  }

  _smoothInputs(dt) {
    const target = clamp(this.input.steer, -1, 1);
    const analog = this.input.analog;
    if (analog) this.steer = lerp(this.steer, target, 1 - Math.exp(-dt * 18));
    else {
      const rate = Math.abs(target) < Math.abs(this.steer) || Math.sign(target) !== Math.sign(this.steer) ? 7.5 : 4.2;
      const d = target - this.steer;
      this.steer += clamp(d, -rate * dt, rate * dt);
    }
    // handbrake drops rear grip at once; it recovers smoothly so drifts can be held and exited
    const hb = this.input.handbrake > 0.5;
    this.rearGrip = hb ? Math.max(this.spec.handbrakeGrip, this.rearGrip - dt * 6) : Math.min(1, this.rearGrip + dt * 1.6);
    this.hbHold = hb ? 1 : Math.max(0, (this.hbHold || 0) - dt / 0.35);
  }

  _gearbox(dt) {
    const g = this.spec.gears;
    const v = Math.abs(this.forwardSpeed);
    if (this.forwardSpeed < -0.5 && this.input.brake > 0.1) { this.gear = -1; }
    else if (this.gear < 1) this.gear = 1;
    if (this.gear >= 1) {
      if (this.gear < g.length - 1 && v > g[this.gear] * 0.96) this.gear++;
      else if (this.gear > 1 && v < g[this.gear - 1] * 0.72) this.gear--;
    }
    const top = this.gear < 0 ? this.spec.reverseMax : g[Math.max(1, this.gear)];
    const low = this.gear <= 1 ? 0 : g[this.gear - 1] * 0.55;
    let frac = clamp((v - low) / Math.max(1, top - low), 0, 1.05);
    const idle = 900, red = 7800;
    let target = idle + frac * (red - idle);
    if (!this.grounded || this.wheels.some((w) => w.contact && w.slipLong > 4)) target = Math.max(target, idle + this.input.throttle * (red - idle) * 0.85);
    this.rpm = lerp(this.rpm, target, 1 - Math.exp(-dt * 14));
  }

  _substep(h) {
    const s = this.spec;
    const m = s.mass;
    this.updateBasis();
    this.onKill = false;
    const fwd = this.fwd, up = this.up, left = this.left;
    const force = _f.set(0, -s.gravity * m, 0);
    const torque = _t.set(0, 0, 0);
    const vF = this.vel.dot(fwd);
    const absV = Math.abs(vF);

    // steering angle shrinks with speed
    const steerMax = s.minSteer + (s.maxSteer - s.minSteer) / (1 + (absV / s.steerFalloff) ** 2);
    const steerAngle = this.steer * steerMax * (this.rampLeft ? s.rampSteer : 1);

    // engine / brake demand
    const thr = clamp(this.input.throttle, 0, 1);
    const brk = clamp(this.input.brake, 0, 1);
    let drive = 0, brakeTotal = 0;
    if (thr > 0.01) {
      if (vF > -1.0) drive = thr * Math.min(s.engineForceMax, s.enginePower / Math.max(absV, 1));
      else brakeTotal = thr * s.brakeForce; // throttle while rolling backwards brakes first
    }
    if (this.input.hold) { drive = 0; brakeTotal = s.brakeForce; } // parked on the grid: brakes, never reverse
    else if (brk > 0.01) {
      if (vF > 1.0) brakeTotal += brk * s.brakeForce;
      else if (vF > -s.reverseMax) drive -= brk * s.reverseForce; // reverse
    }

    // ---- wheels ----------------------------------------------------------
    let grounded = 0;
    let bestSurf = -1, bestGrip = 9;
    const loads = [0, 0, 0, 0];
    const wheels = this.wheels;
    const reach = s.restLen + s.wheelRadius;
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      const mx = this.pos.x + left.x * w.x + up.x * s.mountY + fwd.x * w.z;
      const my = this.pos.y + left.y * w.x + up.y * s.mountY + fwd.y * w.z;
      const mz = this.pos.z + left.z * w.x + up.z * s.mountY + fwd.z * w.z;
      w.mx = mx; w.my = my; w.mz = mz;
      const wasContact = w.contact;
      w.contact = false;
      if (this.world.raycast(mx, my, mz, -up.x, -up.y, -up.z, reach + 0.02, _hit)) {
        const comp = reach - _hit.t;
        if (comp > 0) {
          w.contact = true;
          w.comp = comp;
          w.px = _hit.px; w.py = _hit.py; w.pz = _hit.pz;
          w.nx = _hit.nx; w.ny = _hit.ny; w.nz = _hit.nz;
          w.surf = _hit.mat;
          if (_hit.mat === SURF.kill) this.onKill = true; // a wheel in the water/lava counts
          // velocity of the chassis at the contact point, along the surface normal
          _r.set(_hit.px - this.pos.x, _hit.py - this.pos.y, _hit.pz - this.pos.z);
          _v.crossVectors(this.angVel, _r).add(this.vel);
          const vn = _v.x * _hit.nx + _v.y * _hit.ny + _v.z * _hit.nz;
          const compVel = -vn;
          // progressive damping: hard landings are soaked up instead of bouncing
          const dmp = compVel > 0 ? s.damperC * (compVel > 3 ? 1 + Math.min(2, (compVel - 3) * 0.35) : 1) : s.reboundC;
          let F = s.springK * comp + dmp * compVel;
          // bump stop: stiff, and heavily damped both ways so a hard landing is
          // soaked up instead of springing the car back into the air
          if (comp > s.maxComp) F += s.bumpK * (comp - s.maxComp) + 4 * s.damperC * compVel;
          if (!wasContact && compVel > 4) this.landing = Math.max(this.landing, compVel);
          loads[i] = Math.max(0, F);
        }
      }
      if (!w.contact) w.comp = Math.max(0, w.comp - h * 2.5);
    }
    // anti-roll bars (front pair 0/1, rear pair 2/3)
    for (const [a, b] of [[0, 1], [2, 3]]) {
      if (wheels[a].contact && wheels[b].contact) {
        const d = (wheels[a].comp - wheels[b].comp) * s.antiRoll;
        loads[a] = Math.max(0, loads[a] + d);
        loads[b] = Math.max(0, loads[b] - d);
      }
    }

    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      w.load = loads[i];
      w.steerAngle = w.front ? steerAngle : 0;
      if (!w.contact) {
        // free wheels coast toward the drive demand
        w.spinVel = lerp(w.spinVel, (vF + (w.drive > 0 ? thr * 30 : 0)) / s.wheelRadius, 1 - Math.exp(-h * 3));
        w.slip = 0; w.slipLong = 0;
        continue;
      }
      grounded++;
      const sg = (SURFACE[w.surf] || SURFACE[0]).grip;
      if (sg < bestGrip) { bestGrip = sg; bestSurf = w.surf; }
      const N = loads[i];
      const nx = w.nx, ny = w.ny, nz = w.nz;
      // suspension force along the contact normal, applied at the contact
      _r.set(w.px - this.pos.x, w.py - this.pos.y, w.pz - this.pos.z);
      force.x += nx * N; force.y += ny * N; force.z += nz * N;
      torque.x += _r.y * nz * N - _r.z * ny * N;
      torque.y += _r.z * nx * N - _r.x * nz * N;
      torque.z += _r.x * ny * N - _r.y * nx * N;

      // tyre frame on the contact plane
      const ca = Math.cos(w.steerAngle), sa = Math.sin(w.steerAngle);
      let fx = fwd.x * ca + left.x * sa, fy = fwd.y * ca + left.y * sa, fz = fwd.z * ca + left.z * sa;
      const fd = fx * nx + fy * ny + fz * nz;
      fx -= nx * fd; fy -= ny * fd; fz -= nz * fd;
      const fl = Math.hypot(fx, fy, fz) || 1;
      fx /= fl; fy /= fl; fz /= fl;
      const sx = ny * fz - nz * fy, sy = nz * fx - nx * fz, sz = nx * fy - ny * fx; // side = n x f (left)
      _v.crossVectors(this.angVel, _r).add(this.vel);
      const vl = _v.x * fx + _v.y * fy + _v.z * fz;
      const vs = _v.x * sx + _v.y * sy + _v.z * sz;

      const surf = SURFACE[w.surf] || SURFACE[0];
      let mu = s.mu * surf.grip;
      const Fmax = mu * Math.min(N, s.gripLoadCap);
      // lateral: slip-angle-like saturation, slight falloff once sliding
      const sat = s.latSat + s.latSatSpeed * Math.abs(vl);
      let x = vs / sat;
      const ax = Math.abs(x);
      let lat = ax <= 1 ? x : Math.sign(x) * (1 - s.slideFalloff * Math.min(1, (ax - 1) / 3));
      let latGrip = w.front ? 1 : this.rearGrip;
      let Flat = -Fmax * latGrip * lat;
      // longitudinal
      let Flong = drive * w.drive;
      if (brakeTotal > 0) {
        const share = w.front ? 0.3 : 0.2;
        const maxStop = (Math.abs(vl) * m * 0.25) / h;
        Flong -= Math.sign(vl) * Math.min(brakeTotal * (this.input.hold ? 0.25 : share), maxStop);
      }
      if (!w.front && this.input.handbrake > 0.5) {
        const maxStop = (Math.abs(vl) * m * 0.25) / h;
        Flong -= Math.sign(vl) * Math.min(0.35 * Fmax, maxStop);
      }
      Flong -= vl * (s.rollResist / 4 + surf.drag);
      // friction circle
      const tot = Math.hypot(Flong, Flat);
      let wheelspin = 0;
      if (tot > Fmax && tot > 1e-6) {
        const k = Fmax / tot;
        if (Math.abs(Flong) > Fmax * 0.8 && drive !== 0) wheelspin = (Math.abs(Flong) - Fmax * 0.8) / (m * 0.25);
        Flong *= k; Flat *= k;
      }
      w.slip = Math.abs(vs);
      w.slipLong = wheelspin * 0.3 + (brakeTotal > 0 && Math.abs(Flong) >= Fmax * 0.95 ? 3 : 0);
      w.spinVel = (vl + Math.sign(drive) * wheelspin * 0.25) / s.wheelRadius;
      // apply tyre force slightly above the contact (roll centre) to tame body roll
      const Fx = fx * Flong + sx * Flat, Fy = fy * Flong + sy * Flat, Fz = fz * Flong + sz * Flat;
      force.x += Fx; force.y += Fy; force.z += Fz;
      const rx = _r.x + nx * s.rollCenter, ry = _r.y + ny * s.rollCenter, rz = _r.z + nz * s.rollCenter;
      torque.x += ry * Fz - rz * Fy;
      torque.y += rz * Fx - rx * Fz;
      torque.z += rx * Fy - ry * Fx;
    }
    this.grounded = grounded > 0;
    this.groundedCount = grounded;
    if (grounded) this.surface = bestSurf; // the slipperiest surface under any wheel

    // ---- aero -------------------------------------------------------------
    const sp = this.vel.length();
    force.addScaledVector(this.vel, -s.dragC * sp);
    if (grounded) force.addScaledVector(up, -s.downforce * vF * vF);

    // ---- boost ------------------------------------------------------------
    if (this.boost > 0) force.addScaledVector(fwd, m * s.boostAccel);

    // ---- air control ------------------------------------------------------
    if (!grounded) {
      this._airAttitude(h, thr, brk);
    } else {
      this.airYawOff = 0;
      this._landT = 0;
      // roll stabiliser: past ~20 degrees of roll against the surface, push back
      let nx = 0, ny = 0, nz = 0;
      for (const w of wheels) if (w.contact) { nx += w.nx; ny += w.ny; nz += w.nz; }
      const nl = Math.hypot(nx, ny, nz) || 1;
      const rollG = Math.asin(clamp((left.x * nx + left.y * ny + left.z * nz) / nl, -1, 1));
      const ex = Math.sign(rollG) * Math.max(0, Math.abs(rollG) - 0.33);
      if (ex !== 0) this.angVel.addScaledVector(fwd, (-ex * 14 - this.angVel.dot(fwd) * 2) * h);
      this.angVel.multiplyScalar(1 - h * 0.15);
      if (grounded >= 3 && absV > 4) this._stability(h, vF, absV, sp, steerAngle);
    }

    // ---- integrate ----------------------------------------------------------
    this.vel.addScaledVector(force, h / m);
    if (this.rampLeft && grounded) this.vel.addScaledVector(this.rampLeft, -this.vel.dot(this.rampLeft) * (1 - Math.exp(-h * s.rampDamp)));
    this._applyInvI(torque, _tmp2);
    this.angVel.addScaledVector(_tmp2, h);
    this.pos.addScaledVector(this.vel, h);
    const wx = this.angVel.x, wy = this.angVel.y, wz = this.angVel.z;
    const q = this.quat;
    _q.set(wx, wy, wz, 0).multiply(q);
    q.x += 0.5 * h * _q.x; q.y += 0.5 * h * _q.y; q.z += 0.5 * h * _q.z; q.w += 0.5 * h * _q.w;
    q.normalize();

    this._collide(h);
  }

  // Airborne: turn the car toward its flight direction laid onto the surface it
  // is about to land on, so it touches down on all four wheels pointing where
  // it is going. Brake lifts the nose, accelerate dips it slightly, and
  // steering yaws the car only while held (it drifts back in line after).
  _airAttitude(h, thr, brk) {
    const s = this.spec;
    this._landT = (this._landT || 0) - h;
    if (!(this._landT > 0)) { this._landT = 0.08; this._predictLanding(); }
    const U = _U.copy(this.landN || WORLD_UP);
    const F = _F.copy(this.vel).addScaledVector(U, -this.vel.dot(U));
    if (F.lengthSq() < 9) F.copy(this.fwd).addScaledVector(U, -this.fwd.dot(U)); // barely moving: keep the heading
    if (F.lengthSq() < 1e-8) F.copy(this.up).addScaledVector(U, -this.up.dot(U)); // nose straight up or down
    if (F.lengthSq() < 1e-8) return;
    F.normalize();
    const st = clamp(this.input.steer, -1, 1);
    if (Math.abs(st) > 0.05) this.airYawOff = clamp((this.airYawOff || 0) + st * s.airYawRate * h, -s.airYawMax, s.airYawMax);
    else this.airYawOff = (this.airYawOff || 0) * Math.exp(-h * 1.5);
    if (this.airYawOff) F.applyAxisAngle(U, this.airYawOff);
    const Lv = _Lv.crossVectors(U, F).normalize();
    const bias = brk * s.airNoseUp - thr * s.airNoseDown;
    if (bias) { F.applyAxisAngle(Lv, -bias); U.applyAxisAngle(Lv, -bias); }
    _m4.makeBasis(Lv, U, F);
    _qt.setFromRotationMatrix(_m4);
    // world-frame rotation from where the car points to where it should
    _qe.copy(_qt).multiply(_qi.copy(this.quat).invert());
    if (_qe.w < 0) { _qe.x = -_qe.x; _qe.y = -_qe.y; _qe.z = -_qe.z; _qe.w = -_qe.w; }
    const w = clamp(_qe.w, -1, 1);
    const sinH = Math.sqrt(Math.max(0, 1 - w * w));
    const k = sinH > 1e-6 ? (2 * Math.acos(w)) / sinH : 2;
    _ang.set(_qe.x * k, _qe.y * k, _qe.z * k).multiplyScalar(s.airAssist);
    const len = _ang.length();
    if (len > s.airMaxRate) _ang.multiplyScalar(s.airMaxRate / len);
    // eases in over the first fifth of a second so bumps and crests feel natural
    const grip = 7 * clamp((this.airTime - 0.04) / 0.16, 0, 1);
    this.angVel.lerp(_ang, 1 - Math.exp(-h * grip));
    this.angVel.multiplyScalar(1 - h * 0.6);
  }

  // Follow the ballistic arc until it meets something; remember the normal of
  // the surface we will land on (steep walls don't count).
  _predictLanding() {
    const g = this.spec.gravity;
    const p = this.pos, v = this.vel;
    this.landN = null;
    this.landIn = null;
    let x0 = p.x, y0 = p.y - 0.55, z0 = p.z;
    for (let i = 1; i <= 60; i++) {
      const t = i * 0.06;
      const x1 = p.x + v.x * t, y1 = p.y - 0.55 + v.y * t - 0.5 * g * t * t, z1 = p.z + v.z * t;
      const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
      const len = Math.hypot(dx, dy, dz);
      if (len > 1e-6 && this.world.raycast(x0, y0, z0, dx / len, dy / len, dz / len, len, _hit)) {
        if (_hit.ny > 0.35) { this.landN = this._landVec.set(_hit.nx, _hit.ny, _hit.nz); this.landIn = t; }
        return;
      }
      x0 = x1; y0 = y1; z0 = z1;
    }
  }

  // Arcade stability assist: damps yaw beyond what the steering asks for and
  // pulls the nose back in line with the direction of travel. It stands down
  // while the handbrake is held (and briefly after) so drifts stay possible.
  _stability(h, vF, absV, sp, steerAngle) {
    const s = this.spec;
    const up = this.up;
    const beta = Math.atan2(this.vel.dot(this.left), Math.max(absV, 1));
    const yawRate = this.angVel.dot(up);
    const wKin = (vF * Math.tan(steerAngle)) / 2.64;
    const wGrip = (s.mu * s.gravity * 1.15) / Math.max(sp, 1);
    const wDes = clamp(wKin, -wGrip, wGrip);
    const assist = 1 - this.hbHold;
    let alpha = 0;
    const excess = yawRate - wDes;
    if (Math.abs(yawRate) > Math.abs(wDes) && Math.sign(excess) === Math.sign(yawRate)) alpha -= excess * s.yawAssist * assist;
    const bEx = Math.sign(beta) * Math.max(0, Math.abs(beta) - 0.1);
    alpha += bEx * s.slipAssist * assist;
    if (Math.abs(yawRate) > s.maxYaw) alpha -= (yawRate - Math.sign(yawRate) * s.maxYaw) * 10;
    alpha = clamp(alpha, -s.assistMax, s.assistMax);
    this.angVel.addScaledVector(up, alpha * h);
  }

  _collide(h) {
    const s = this.spec;
    const m = s.mass;
    this.updateBasis();
    for (let pass = 0; pass < 2; pass++) {
      for (const sph of s.bodySpheres) {
        const cx = this.pos.x + this.left.x * sph[0] + this.up.x * sph[1] + this.fwd.x * sph[2];
        const cy = this.pos.y + this.left.y * sph[0] + this.up.y * sph[1] + this.fwd.y * sph[2];
        const cz = this.pos.z + this.left.z * sph[0] + this.up.z * sph[1] + this.fwd.z * sph[2];
        const n = this.world.sphere(cx, cy, cz, s.bodyRadius, _contacts, 6);
        for (let k = 0; k < n; k++) {
          const c = _contacts[k];
          if (c.mat === SURF.kill) this.onKill = true;
          // recompute depth against current position (earlier contacts may have moved us)
          const dx = this.pos.x + this.left.x * sph[0] + this.up.x * sph[1] + this.fwd.x * sph[2] - c.px;
          const dy = this.pos.y + this.left.y * sph[0] + this.up.y * sph[1] + this.fwd.y * sph[2] - c.py;
          const dz = this.pos.z + this.left.z * sph[0] + this.up.z * sph[1] + this.fwd.z * sph[2] - c.pz;
          const along = dx * c.nx + dy * c.ny + dz * c.nz;
          const depth = s.bodyRadius - along;
          if (depth <= 0) continue;
          this.pos.x += c.nx * depth; this.pos.y += c.ny * depth; this.pos.z += c.nz * depth;
          // impulse at the contact point
          _r.set(c.px - this.pos.x, c.py - this.pos.y, c.pz - this.pos.z);
          _v.crossVectors(this.angVel, _r).add(this.vel);
          const vn = _v.x * c.nx + _v.y * c.ny + _v.z * c.nz;
          if (vn >= 0) continue;
          _tmp.set(c.nx, c.ny, c.nz);
          _tmp2.crossVectors(_r, _tmp);
          this._applyInvI(_tmp2, _tmp2);
          const angTerm = _tmp.dot(_tmp3.crossVectors(_tmp2, _r));
          // the underside meeting the road (a hard landing) neither bounces nor
          // scrubs off speed; a door or bumper hitting a wall does
          const belly = c.nx * this.up.x + c.ny * this.up.y + c.nz * this.up.z > 0.6;
          const e = belly ? 0 : 0.12;
          const j = (-(1 + e) * vn) / (1 / m + angTerm);
          this._impulse(_tmp.x * j, _tmp.y * j, _tmp.z * j, _r);
          // friction
          const tx = _v.x - c.nx * vn, ty = _v.y - c.ny * vn, tz = _v.z - c.nz * vn;
          const vt = Math.hypot(tx, ty, tz);
          if (vt > 1e-4) {
            const mu = belly ? 0.05 : c.mat === SURF.wall ? 0.22 : 0.4;
            const jt = Math.min(mu * j, (vt * m) / 3);
            this._impulse((-tx / vt) * jt, (-ty / vt) * jt, (-tz / vt) * jt, _r);
          }
          this.impact = Math.max(this.impact, j);
          if (vt > 3) this.scrape = Math.max(this.scrape, vt);
        }
      }
      this.updateBasis();
    }
  }

  _impulse(jx, jy, jz, r) {
    const m = this.spec.mass;
    this.vel.x += jx / m; this.vel.y += jy / m; this.vel.z += jz / m;
    _ang.set(r.y * jz - r.z * jy, r.z * jx - r.x * jz, r.x * jy - r.y * jx);
    this._applyInvI(_ang, _ang);
    this.angVel.add(_ang);
  }

  // snapshot for networking / replays
  snapshot() {
    return {
      p: [this.pos.x, this.pos.y, this.pos.z],
      q: [this.quat.x, this.quat.y, this.quat.z, this.quat.w],
      v: [this.vel.x, this.vel.y, this.vel.z],
    };
  }
}
