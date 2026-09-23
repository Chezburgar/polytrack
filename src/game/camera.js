// Chase / far / hood cameras plus an orbit mode for menus and replays.
//
// The chase camera's "up" is world up on ordinary road and blends to the road's
// own normal where the road is steep (loops, wall rides), so it follows the car
// round a loop without ever copying the car's tumble: a car on its roof or
// cartwheeling through the air never turns the picture upside down. In a loop
// the view direction is carried along with the road frame, so the camera rides
// the loop instead of lagging behind and cutting through the track.
import * as THREE from 'three';
import { clamp, damp } from '../util/math.js';
import { frameQuat } from './race.js';

export const CAMERA_MODES = ['chase', 'far', 'hood'];
const PRESETS = {
  chase: { dist: 6.4, height: 2.05, look: 1.2, lookAhead: 5, fov: 70 },
  far: { dist: 9.2, height: 3.1, look: 1.4, lookAhead: 6, fov: 66 },
  hood: { dist: -0.2, height: 0.62, look: 0.55, lookAhead: 20, fov: 78 },
};

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _back = new THREE.Vector3(), _hit = {};
const _up = new THREE.Vector3(), _dir = new THREE.Vector3(), _d = new THREE.Vector3();
const _q = new THREE.Quaternion(), _dq = new THREE.Quaternion(), _id = new THREE.Quaternion();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'chase';
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this.heading = new THREE.Vector3(0, 0, 1);
    this.roadN = new THREE.Vector3(0, 1, 0); // last road normal seen (kept while airborne)
    this.roadQ = new THREE.Quaternion();
    this.hasRoadQ = false;
    this.follow = 0; // 0 = world up, 1 = road normal
    this.bank = 0; // slight lean with banked corners
    this.fov = 70;
    this.shake = 0;
    this.baseFov = 70;
    this.orbit = { angle: 0, radius: 11, height: 3.6, speed: 0.25 };
    this.initialised = false;
  }

  setMode(m) { this.mode = m; }
  cycle() { const i = CAMERA_MODES.indexOf(this.mode); this.mode = CAMERA_MODES[(i + 1) % CAMERA_MODES.length]; return this.mode; }

  snap(target) { this.initialised = false; this.update(target, 1 / 60); }

  // target: { pos, quat, vel, up, fwd, boost, grounded, road: {p,t,n,l} | null }
  update(t, dt, world = null, lookBack = false) {
    const cam = this.camera;
    if (this.mode === 'orbit') {
      this.orbit.angle += this.orbit.speed * dt;
      const o = this.orbit;
      const pos = _v.set(t.pos.x + Math.cos(o.angle) * o.radius, t.pos.y + o.height, t.pos.z + Math.sin(o.angle) * o.radius);
      if (!this.initialised) { this.pos.copy(pos); this.initialised = true; }
      this.pos.lerp(pos, 1 - Math.exp(-dt * 4));
      cam.position.copy(this.pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(t.pos.x, t.pos.y + 0.6, t.pos.z);
      cam.fov = 50;
      cam.updateProjectionMatrix();
      return;
    }
    const p = PRESETS[this.mode];
    const speed = t.vel.length();
    const road = t.road;
    const first = !this.initialised;

    if (this.mode === 'hood') {
      // bolted to the car: it rolls and loops with it
      this.up.copy(t.up);
      this.heading.copy(t.fwd);
      const hood = _v.copy(t.pos).addScaledVector(t.up, p.height).addScaledVector(t.fwd, 0.3);
      this.pos.copy(hood);
      this.look.copy(hood).addScaledVector(t.fwd, lookBack ? -20 : 20).addScaledVector(t.up, -0.4);
      this.initialised = true;
    } else {
      // ---- which way is up -------------------------------------------------
      // steep road (a loop, a wall ride): follow the road normal; ordinary road:
      // world up with a slight lean into banked corners; airborne: world up
      const steep = road ? clamp((0.8 - road.n.y) / 0.45, 0, 1) : 0;
      if (road) this.roadN.copy(road.n);
      if (first) { this.follow = steep; this.bank = road ? 0.25 : 0; }
      this.follow = damp(this.follow, steep, road ? 12 : 3, dt);
      this.bank = damp(this.bank, road ? 0.25 : 0, 3, dt);
      const a = Math.max(this.follow, this.bank);
      _up.copy(WORLD_UP).multiplyScalar(1 - a).addScaledVector(this.roadN, a);
      if (_up.lengthSq() < 1e-6) _up.copy(this.roadN);
      this.up.copy(_up.normalize());

      // ---- which way to look -----------------------------------------------
      // the car's nose blended with its direction of travel (drifts, jumps);
      // in the air travel direction dominates so a spinning car doesn't whip
      // the camera round
      _dir.copy(t.fwd);
      if (speed > 4) {
        _w.copy(t.vel).normalize();
        const k = t.grounded === false ? clamp((speed - 4) / 10, 0, 0.9) : clamp((speed - 4) / 20, 0, 0.55);
        _dir.lerp(_w, k);
      }
      _dir.addScaledVector(this.up, -_dir.dot(this.up));
      const ok = _dir.lengthSq() > 1e-4;
      if (ok) _dir.normalize();
      // ride along with the road frame on steep road so a loop never leaves the
      // camera behind
      if (road) {
        frameQuat(road.l, road.n, road.t, _q);
        if (this.hasRoadQ && !first && this.follow > 0.01) {
          _dq.copy(this.roadQ).invert().premultiply(_q); // rotation since last frame
          if (_dq.w < 0) { _dq.x = -_dq.x; _dq.y = -_dq.y; _dq.z = -_dq.z; _dq.w = -_dq.w; }
          _id.identity().slerp(_dq, this.follow);
          this.heading.applyQuaternion(_id);
        }
        this.roadQ.copy(_q);
        this.hasRoadQ = true;
      } else this.hasRoadQ = false;
      if (first) this.heading.copy(ok ? _dir : t.fwd);
      else if (ok) this.heading.lerp(_dir, 1 - Math.exp(-dt * (t.grounded === false ? 4 : 7.5)));
      this.heading.addScaledVector(this.up, -this.heading.dot(this.up));
      if (this.heading.lengthSq() < 1e-6) this.heading.copy(ok ? _dir : t.fwd);
      this.heading.normalize();

      // ---- where to stand ----------------------------------------------------
      const back = _back.copy(this.heading).multiplyScalar(lookBack ? -1 : 1);
      const desired = _v.copy(t.pos).addScaledVector(back, -p.dist).addScaledVector(this.up, p.height);
      const lookAt = _w.copy(t.pos).addScaledVector(back, p.lookAhead).addScaledVector(this.up, p.look);
      if (first) { this.pos.copy(desired); this.look.copy(lookAt); }
      else {
        // stiffer at speed and in loops so the car never escapes the frame;
        // a little softer along "up" so bumps don't shake the view
        const k = (9 + clamp(speed / 10, 0, 6)) * (1 + this.follow * 1.5);
        _d.subVectors(desired, this.pos);
        const along = _d.dot(this.up);
        _d.addScaledVector(this.up, -along);
        this.pos.addScaledVector(_d, 1 - Math.exp(-dt * k)).addScaledVector(this.up, along * (1 - Math.exp(-dt * k * 0.8)));
        this.look.lerp(lookAt, 1 - Math.exp(-dt * 14));
      }
      this.initialised = true;
      // keep a sane distance from the car
      _v.subVectors(this.pos, t.pos);
      const dd = _v.length(), maxD = p.dist * 1.6 + 2;
      if (dd > maxD) this.pos.copy(t.pos).addScaledVector(_v, maxD / dd);
      // don't clip through road surfaces (loops, tunnels)
      if (world) {
        _v.subVectors(this.pos, t.pos);
        const len = _v.length();
        if (len > 0.5) {
          _v.divideScalar(len);
          const from = _w.copy(t.pos).addScaledVector(this.up, 0.9);
          if (world.raycast(from.x, from.y, from.z, _v.x, _v.y, _v.z, len, _hit) && _hit.mat !== 4) {
            this.pos.copy(from).addScaledVector(_v, Math.max(0.6, _hit.t - 0.35));
          }
        }
      }
    }
    // speed + boost FOV
    const kmh = speed * 3.6;
    const targetFov = this.baseFov + (p.fov - 70) + clamp((kmh - 60) / 200, 0, 1) * 12 + (t.boost > 0 ? 7 : 0);
    this.fov = first ? targetFov : damp(this.fov, targetFov, 3, dt);
    cam.fov = this.fov;
    cam.updateProjectionMatrix();

    cam.position.copy(this.pos);
    if (this.shake > 0) {
      const s = this.shake;
      cam.position.x += (Math.random() - 0.5) * s * 0.15;
      cam.position.y += (Math.random() - 0.5) * s * 0.15;
      this.shake = Math.max(0, this.shake - dt * 4);
    }
    cam.up.copy(this.up);
    cam.lookAt(this.look);
  }
}
