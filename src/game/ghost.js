// Ghost runs: position + orientation sampled at 30 Hz, stored compactly
// (float32 position, int16 quaternion) and base64'd for localStorage.
import { Vector3, Quaternion } from 'three';

export const GHOST_HZ = 30;

export class GhostRecorder {
  constructor() { this.frames = []; this.t = 0; this.next = 0; }
  reset() { this.frames = []; this.next = 0; }
  // call every physics tick with race time (s)
  sample(time, pos, quat, steer) {
    if (time + 1e-9 < this.next) return;
    this.next = time + 1 / GHOST_HZ;
    this.frames.push([time, pos.x, pos.y, pos.z, quat.x, quat.y, quat.z, quat.w, steer]);
  }
  encode(meta = {}) {
    const n = this.frames.length;
    const buf = new ArrayBuffer(n * (4 * 4 + 2 * 4 + 1));
    const dv = new DataView(buf);
    let o = 0;
    for (const f of this.frames) {
      dv.setFloat32(o, f[0], true); dv.setFloat32(o + 4, f[1], true); dv.setFloat32(o + 8, f[2], true); dv.setFloat32(o + 12, f[3], true);
      o += 16;
      for (let k = 4; k < 8; k++) { dv.setInt16(o, Math.round(Math.max(-1, Math.min(1, f[k])) * 32767), true); o += 2; }
      dv.setInt8(o, Math.round(Math.max(-1, Math.min(1, f[8])) * 127)); o += 1;
    }
    return { v: 1, n, meta, data: bytesToB64(new Uint8Array(buf)) };
  }
}

export class GhostPlayer {
  constructor(encoded) {
    const bytes = b64ToBytes(encoded.data);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.meta = encoded.meta || {};
    const n = encoded.n;
    this.t = new Float32Array(n);
    this.p = new Float32Array(n * 3);
    this.q = new Float32Array(n * 4);
    this.steer = new Float32Array(n);
    let o = 0;
    for (let i = 0; i < n; i++) {
      this.t[i] = dv.getFloat32(o, true);
      this.p[i * 3] = dv.getFloat32(o + 4, true); this.p[i * 3 + 1] = dv.getFloat32(o + 8, true); this.p[i * 3 + 2] = dv.getFloat32(o + 12, true);
      o += 16;
      for (let k = 0; k < 4; k++) { this.q[i * 4 + k] = dv.getInt16(o, true) / 32767; o += 2; }
      this.steer[i] = dv.getInt8(o) / 127; o += 1;
    }
    this.n = n;
    this.cursor = 0;
    this.duration = n ? this.t[n - 1] : 0;
  }

  // interpolated pose at race time; returns false past the end
  sample(time, pos, quat, vel = null) {
    if (!this.n) return false;
    if (time <= this.t[0]) { this._set(0, 0, 0, pos, quat); return true; }
    if (time >= this.t[this.n - 1]) { this._set(this.n - 1, this.n - 1, 0, pos, quat); return false; }
    let i = this.cursor;
    if (this.t[i] > time) i = 0;
    while (i + 1 < this.n && this.t[i + 1] < time) i++;
    this.cursor = i;
    const f = (time - this.t[i]) / Math.max(1e-6, this.t[i + 1] - this.t[i]);
    this._set(i, i + 1, f, pos, quat);
    if (vel) {
      const dt = this.t[i + 1] - this.t[i];
      vel.set((this.p[(i + 1) * 3] - this.p[i * 3]) / dt, (this.p[(i + 1) * 3 + 1] - this.p[i * 3 + 1]) / dt, (this.p[(i + 1) * 3 + 2] - this.p[i * 3 + 2]) / dt);
    }
    return true;
  }

  steerAt(time) {
    let i = this.cursor;
    return this.steer[Math.min(this.n - 1, i)] || 0;
  }

  _set(a, b, f, pos, quat) {
    const P = this.p, Q = this.q;
    pos.set(P[a * 3] + (P[b * 3] - P[a * 3]) * f, P[a * 3 + 1] + (P[b * 3 + 1] - P[a * 3 + 1]) * f, P[a * 3 + 2] + (P[b * 3 + 2] - P[a * 3 + 2]) * f);
    _qa.set(Q[a * 4], Q[a * 4 + 1], Q[a * 4 + 2], Q[a * 4 + 3]).normalize();
    _qb.set(Q[b * 4], Q[b * 4 + 1], Q[b * 4 + 2], Q[b * 4 + 3]).normalize();
    quat.slerpQuaternions(_qa, _qb, f);
  }
}
const _qa = new Quaternion(), _qb = new Quaternion();

export function bytesToB64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64ToBytes(b64) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export { Vector3 };
