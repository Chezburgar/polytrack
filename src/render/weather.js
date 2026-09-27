// Weather around the camera: rain, snow, dust, embers or fireflies. A box of
// particles travels with the camera and wraps at its edges, so the whole course
// looks rained on while only a few thousand drops exist.
//   theme.weather = { kind: 'rain'|'snow'|'dust'|'embers'|'fireflies', amount: 0..1, color }
import * as THREE from 'three';
import { mulberry32 } from '../util/math.js';

const KINDS = {
  // n at amount 1, box size (x/z, y), fall speed, sideways drift, size, colour, opacity
  rain: { n: 2600, box: [70, 44], fall: 30, drift: [2.5, 0.8], len: 1.2, color: 0xb8c8dc, opacity: 0.42 },
  snow: { n: 3200, box: [80, 46], fall: 2.2, drift: [0.8, 0.5], size: 0.22, sway: 0.9, color: 0xffffff, opacity: 0.9 },
  dust: { n: 2600, box: [90, 30], fall: -0.2, drift: [9, 2.5], size: 0.16, sway: 0.4, color: 0xd99a6a, opacity: 0.55 },
  embers: { n: 900, box: [90, 50], fall: -2.4, drift: [1.2, 0.8], size: 0.24, sway: 1.2, color: 0xff7a2a, opacity: 1, glow: true },
  fireflies: { n: 500, box: [90, 16], fall: 0, drift: [0.4, 0.4], size: 0.2, sway: 1.6, color: 0xb8ff6a, opacity: 1, glow: true },
};
const NEAR = 3.5; // particles closer to the camera than this are hidden

export function buildWeather(theme, seed = 1) {
  const w = theme.weather;
  const K = w && KINDS[w.kind];
  if (!K) return null;
  const rnd = mulberry32(seed);
  const n = Math.round(K.n * (w.amount ?? 1));
  const [bx, by] = K.box;
  const lines = w.kind === 'rain';
  const base = new Float32Array(n * 3); // each particle's position inside the box
  const phase = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    base[i * 3] = (rnd() - 0.5) * bx;
    base[i * 3 + 1] = (rnd() - 0.5) * by;
    base[i * 3 + 2] = (rnd() - 0.5) * bx;
    phase[i] = rnd() * Math.PI * 2;
  }
  const pos = new Float32Array(n * 3 * (lines ? 2 : 1));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const color = new THREE.Color(w.color ?? K.color);
  if (K.glow) color.multiplyScalar(2.2); // bright enough to bloom
  const mat = lines
    ? new THREE.LineBasicMaterial({ color, transparent: true, opacity: K.opacity, depthWrite: false, fog: true })
    : new THREE.PointsMaterial({ color, size: K.size, sizeAttenuation: true, transparent: true, opacity: K.opacity, depthWrite: false, map: dotTexture(), alphaTest: 0.05, fog: !K.glow });
  const obj = lines ? new THREE.LineSegments(geo, mat) : new THREE.Points(geo, mat);
  obj.frustumCulled = false;
  obj.renderOrder = 5;
  obj.name = 'weather';
  // the whole box drifts; particles wrap back in on the far side
  const off = new THREE.Vector3();
  const wind = new THREE.Vector3(K.drift[0], 0, K.drift[1]);
  let t = 0;
  const update = (dt, cam) => {
    t += dt;
    off.x += wind.x * dt; off.z += wind.z * dt; off.y -= K.fall * dt;
    const wrap = (v, size) => v - size * Math.floor(v / size + 0.5);
    for (let i = 0; i < n; i++) {
      const sway = K.sway ? Math.sin(t * 0.9 + phase[i]) * K.sway : 0;
      // position relative to the camera, wrapped into the box around it
      const x = wrap(base[i * 3] + off.x + sway - cam.x, bx) + cam.x;
      const y = wrap(base[i * 3 + 1] + off.y + (K.sway ? Math.cos(t * 0.7 + phase[i]) * K.sway * 0.4 : 0) - cam.y, by) + cam.y;
      const z = wrap(base[i * 3 + 2] + off.z + (K.sway ? Math.cos(t * 0.8 + phase[i] * 1.3) * K.sway : 0) - cam.z, bx) + cam.z;
      if (lines) {
        const j = i * 6;
        pos[j] = x; pos[j + 1] = y; pos[j + 2] = z;
        // a streak along the fall and the wind
        pos[j + 3] = x - wind.x * 0.03; pos[j + 4] = y + K.len; pos[j + 5] = z - wind.z * 0.03;
      } else {
        const j = i * 3;
        // a flake right at the lens would be drawn as a disc filling the screen:
        // drop anything that close out of sight until it drifts on
        const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
        const hide = dx * dx + dy * dy + dz * dz < NEAR * NEAR;
        pos[j] = x; pos[j + 1] = hide ? cam.y - 9999 : y; pos[j + 2] = z;
      }
    }
    geo.attributes.position.needsUpdate = true;
    if (K.glow && w.kind === 'fireflies') mat.opacity = 0.65 + Math.sin(t * 2.3) * 0.35;
  };
  return { object: obj, update };
}

// a soft round dot for snow, dust and glow particles
let _dot = null;
function dotTexture() {
  if (_dot) return _dot;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  _dot = new THREE.CanvasTexture(c);
  return _dot;
}
