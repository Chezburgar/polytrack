// Chase / far / hood cameras that follow the car through loops (the camera's
// up vector eases toward the car's), plus an orbit mode for menus and replays.
import * as THREE from 'three';
import { clamp, damp } from '../util/math.js';

export const CAMERA_MODES = ['chase', 'far', 'hood'];
const PRESETS = {
  chase: { dist: 6.4, height: 2.05, look: 1.2, lookAhead: 5, fov: 70 },
  far: { dist: 9.2, height: 3.1, look: 1.4, lookAhead: 6, fov: 66 },
  hood: { dist: -0.2, height: 0.62, look: 0.55, lookAhead: 20, fov: 78 },
};

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _back = new THREE.Vector3(), _hit = {};

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'chase';
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this.heading = new THREE.Vector3(0, 0, 1);
    this.fov = 70;
    this.shake = 0;
    this.baseFov = 70;
    this.fovBoost = 1;
    this.orbit = { angle: 0, radius: 11, height: 3.6, speed: 0.25 };
    this.initialised = false;
  }

  setMode(m) { this.mode = m; }
  cycle() { const i = CAMERA_MODES.indexOf(this.mode); this.mode = CAMERA_MODES[(i + 1) % CAMERA_MODES.length]; return this.mode; }

  snap(target) { this.initialised = false; this.update(target, 1 / 60); }

  // target: { pos, quat, vel, up, fwd, speed, boost }
  update(t, dt, world = null, lookBack = false) {
    const p = this.mode === 'orbit' ? null : PRESETS[this.mode];
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
    // heading blends the car's nose with its direction of travel (drifts, jumps)
    const speed = t.vel.length();
    _v.copy(t.fwd);
    if (speed > 4) {
      _w.copy(t.vel).normalize();
      const k = clamp((speed - 4) / 20, 0, 0.55);
      _v.lerp(_w, k).normalize();
    }
    if (!this.initialised) {
      this.heading.copy(t.fwd);
      this.up.copy(t.up);
    }
    const hk = this.mode === 'hood' ? 30 : 7.5;
    this.heading.lerp(_v, 1 - Math.exp(-dt * hk)).normalize();
    this.up.lerp(t.up, 1 - Math.exp(-dt * (this.mode === 'hood' ? 30 : 3.2))).normalize();
    // pull the up vector back to world up when the car is only slightly tilted
    const upW = _w.set(0, 1, 0);
    const tilt = t.up.dot(upW);
    if (tilt > 0.75) this.up.lerp(upW, 1 - Math.exp(-dt * 4)).normalize();

    const back = _back.copy(this.heading).multiplyScalar(lookBack ? -1 : 1);
    const desired = new THREE.Vector3().copy(t.pos)
      .addScaledVector(back, -p.dist)
      .addScaledVector(this.up, p.height);
    const lookAt = new THREE.Vector3().copy(t.pos)
      .addScaledVector(back, p.lookAhead)
      .addScaledVector(this.up, p.look);

    if (!this.initialised) { this.pos.copy(desired); this.look.copy(lookAt); this.initialised = true; }
    if (this.mode === 'hood') {
      const hood = new THREE.Vector3().copy(t.pos).addScaledVector(t.up, p.height).addScaledVector(t.fwd, 0.3);
      this.pos.copy(hood);
      this.look.copy(hood).addScaledVector(lookBack ? t.fwd.clone().negate() : t.fwd, 20).addScaledVector(t.up, -0.4);
    } else {
      // stiffer follow at speed so the car never escapes the frame
      const k = 9 + clamp(speed / 10, 0, 6);
      this.pos.x = damp(this.pos.x, desired.x, k, dt);
      this.pos.y = damp(this.pos.y, desired.y, k * 0.8, dt);
      this.pos.z = damp(this.pos.z, desired.z, k, dt);
      // keep the camera a sane distance from the car
      _v.subVectors(this.pos, t.pos);
      const d = _v.length(), maxD = p.dist * 1.6 + 2;
      if (d > maxD) this.pos.copy(t.pos).addScaledVector(_v, maxD / d);
      this.look.lerp(lookAt, 1 - Math.exp(-dt * 14));
      // don't clip through road surfaces (loops, tunnels)
      if (world) {
        _v.subVectors(this.pos, t.pos);
        const len = _v.length();
        if (len > 0.5) {
          _v.divideScalar(len);
          const from = _w.copy(t.pos).addScaledVector(t.up, 0.9);
          if (world.raycast(from.x, from.y, from.z, _v.x, _v.y, _v.z, len, _hit) && _hit.mat !== 4) {
            this.pos.copy(from).addScaledVector(_v, Math.max(0.6, _hit.t - 0.35));
          }
        }
      }
    }
    // speed + boost FOV
    const kmh = speed * 3.6;
    const targetFov = this.baseFov + (p.fov - 70) + clamp((kmh - 60) / 200, 0, 1) * 12 + (t.boost > 0 ? 7 : 0);
    this.fov = damp(this.fov, targetFov, 3, dt);
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
