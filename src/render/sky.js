// Gradient sky dome with sun glow and optional stars, low-poly clouds, and a
// ring of distant mountains pre-blended into the horizon haze.
import * as THREE from 'three';
import { mulberry32, hashString, makeNoise2D } from '../util/math.js';

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const skyFrag = /* glsl */ `
uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunColor; uniform vec3 sunDir;
uniform float stars; uniform float sunSize;
varying vec3 vDir;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = h > 0.0 ? mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(horizon, bottom, clamp(-h * 4.0, 0.0, 1.0));
  float s = max(dot(d, normalize(sunDir)), 0.0);
  col += sunColor * (pow(s, 900.0 / sunSize) * 6.0 + pow(s, 24.0) * 0.28 + pow(s, 4.0) * 0.08);
  if (stars > 0.0 && h > 0.0) {
    vec3 q = floor(d * 380.0);
    float r = hash(q);
    float tw = step(0.9965, r) * (0.5 + 0.5 * hash(q + 7.0));
    col += vec3(tw) * stars * smoothstep(0.0, 0.25, h) * 1.6;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function buildSky(theme, seed = 1) {
  const group = new THREE.Group();
  group.name = 'sky';
  const sky = theme.sky;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color(sky.top) },
      horizon: { value: new THREE.Color(sky.horizon) },
      bottom: { value: new THREE.Color(sky.bottom) },
      sunColor: { value: new THREE.Color(sky.sun) },
      sunDir: { value: new THREE.Vector3(...theme.sun.dir).normalize() },
      stars: { value: theme.stars || 0 },
      sunSize: { value: theme.sunSize || 1 },
    },
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  group.add(dome);
  group.userData.dome = dome;

  const rnd = mulberry32(hashString('sky' + seed));
  // clouds: clusters of flattened icosahedra, merged into one mesh
  if (theme.clouds !== null) {
    const positions = [];
    const colors = [];
    const cloudCol = new THREE.Color(theme.clouds ?? 0xffffff);
    const shade = cloudCol.clone().multiplyScalar(0.82);
    const base = new THREE.IcosahedronGeometry(1, 0); // already non-indexed
    const bp = base.attributes.position.array;
    const count = theme.cloudCount ?? 26;
    for (let c = 0; c < count; c++) {
      const ang = rnd() * Math.PI * 2;
      const dist = 350 + rnd() * 700;
      const cx = Math.cos(ang) * dist, cz = Math.sin(ang) * dist, cy = 150 + rnd() * 160;
      const puffs = 3 + Math.floor(rnd() * 4);
      const scale = 14 + rnd() * 18;
      for (let p = 0; p < puffs; p++) {
        const ox = (p - puffs / 2) * scale * 0.9 + (rnd() - 0.5) * scale * 0.6;
        const oz = (rnd() - 0.5) * scale * 0.9;
        const r = scale * (0.7 + rnd() * 0.6);
        const rot = rnd() * Math.PI;
        const cr = Math.cos(rot), sr = Math.sin(rot);
        for (let i = 0; i < bp.length; i += 9) {
          let bright = 0;
          for (let v = 0; v < 3; v++) {
            const x = bp[i + v * 3], y = bp[i + v * 3 + 1], z = bp[i + v * 3 + 2];
            const rx = x * cr - z * sr, rz = x * sr + z * cr;
            positions.push(cx + ox + rx * r * 1.25, cy + Math.max(-0.35, y) * r * 0.55, cz + oz + rz * r);
            bright += y;
          }
          const col = bright > 0 ? cloudCol : shade;
          for (let v = 0; v < 3; v++) colors.push(col.r, col.g, col.b);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const clouds = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true, opacity: 0.92, depthWrite: false }));
    clouds.renderOrder = -5;
    clouds.frustumCulled = false;
    group.add(clouds);
    group.userData.clouds = clouds;
  }

  // distant mountains: jagged ring, colours hazed toward the horizon
  if (theme.mountains) {
    const noise = makeNoise2D(hashString('mtn' + seed));
    const segs = 150;
    const rings = [
      { r: 1350, h: 230, col: theme.mountains[0] },
      { r: 1150, h: 150, col: theme.mountains[1] },
    ];
    const positions = [], colors = [];
    const horizon = new THREE.Color(theme.sky.horizon);
    const snow = new THREE.Color(theme.mountains[2] ?? 0xffffff);
    for (const [ri, ring] of rings.entries()) {
      const col = new THREE.Color(ring.col);
      const top = [];
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const n = noise.fbm(Math.cos(a) * 3 + ri * 10, Math.sin(a) * 3, 4);
        const hh = Math.max(20, ring.h * (0.45 + n * 1.1) + (i % 2 ? ring.h * 0.12 : 0));
        const rr = ring.r + (rnd() - 0.5) * 60;
        top.push(new THREE.Vector3(Math.cos(a) * rr, hh, Math.sin(a) * rr));
      }
      for (let i = 0; i < segs; i++) {
        const a = top[i], b = top[i + 1];
        const a0 = a.clone().setY(-40), b0 = b.clone().setY(-40);
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const peak = mid.clone(); peak.y = Math.max(a.y, b.y) * (1.02 + rnd() * 0.15);
        // two triangles for the body, one for a peak facet
        const quad = [[a0, b0, b], [a0, b, a]];
        for (const [p, q, r] of quad) {
          positions.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
          const shadeK = 0.85 + rnd() * 0.2;
          for (const v of [p, q, r]) {
            const t = Math.min(1, Math.max(0, v.y / (ring.h * 1.4)));
            const c = col.clone().multiplyScalar(shadeK).lerp(horizon, (1 - t) * 0.55 + ri * 0.1);
            if (theme.snowcaps && v.y > ring.h * 0.85) c.lerp(snow, 0.8);
            colors.push(c.r, c.g, c.b);
          }
        }
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z, peak.x, peak.y, peak.z);
        for (const v of [a, b, peak]) {
          const c = col.clone().multiplyScalar(1.08).lerp(horizon, 0.25 + ri * 0.1);
          if (theme.snowcaps) c.lerp(snow, 0.85);
          colors.push(c.r, c.g, c.b);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
    m.renderOrder = -4;
    m.frustumCulled = false;
    group.add(m);
    group.userData.mountains = m;
  }
  return group;
}

// Keep sky, clouds and mountains centred on the camera horizontally.
export function followSky(sky, camPos) {
  sky.position.set(camPos.x, 0, camPos.z);
  const d = sky.userData.dome;
  if (d) d.position.set(0, camPos.y, 0);
}
