// Procedural low-poly car models built from a body loft plus bolt-on parts,
// painted with a livery atlas. One model per car instance; rebuilding is cheap,
// so the garage just rebuilds on every change.
import * as THREE from 'three';
import { BODIES } from './bodies.js';
import { paintLivery, sideUV, topUV, endUV, ATLAS } from './livery.js';
import { CAR_SPEC } from '../physics/car.js';

export const CG_Y = 0.572; // centre of mass height above the ground at rest
export const WHEEL_R = CAR_SPEC.wheelRadius;

export const DEFAULT_CAR = {
  body: 'bolt', paint: '#e8433a', accent: '#f4f4f4', detail: '#15171c', finish: 'gloss',
  livery: 'stripes', showNumber: true, number: 7, rim: 'sport', rimColor: '#c9ced6',
  spoiler: 'wing', underglow: 'none', trail: '#39e6ff', tint: 'dark', tire: 'slick',
};

export const FINISHES = {
  gloss: { name: 'Gloss', rough: 0.3, metal: 0.12, env: 1.0 },
  metallic: { name: 'Metallic', rough: 0.34, metal: 0.62, env: 1.15 },
  matte: { name: 'Matte', rough: 0.82, metal: 0.0, env: 0.45 },
  chrome: { name: 'Chrome', rough: 0.07, metal: 1.0, env: 1.5 },
  pearl: { name: 'Pearl', rough: 0.22, metal: 0.3, env: 1.1, iridescence: 1 },
  satin: { name: 'Satin', rough: 0.55, metal: 0.35, env: 0.8 },
};
export const RIMS = ['sport', 'mesh', 'disc', 'spoke3', 'turbine', 'classic'];
export const RIM_NAMES = { sport: 'Sport 5', mesh: 'Mesh', disc: 'Aero Disc', spoke3: 'Tri-Spoke', turbine: 'Turbine', classic: 'Steelie' };
export const SPOILERS = ['none', 'lip', 'wing', 'gt', 'duck'];
export const SPOILER_NAMES = { none: 'None', lip: 'Lip', wing: 'Wing', gt: 'GT Wing', duck: 'Ducktail' };
export const TINTS = { dark: 0x0e1419, light: 0x3a4c5a, mirror: 0x6d7f8c, amber: 0x3d2a10 };

// ---------------------------------------------------------------------------
class Soup {
  constructor() { this.pos = []; this.col = []; this.uv = []; }
  tri(a, b, c, col, uvs) {
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    if (col) for (let i = 0; i < 3; i++) this.col.push(col.r, col.g, col.b);
    if (uvs) this.uv.push(...uvs[0], ...uvs[1], ...uvs[2]);
  }
  addGeometry(geo, color, matrix) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    const p = g.attributes.position.array;
    const c = new THREE.Color(color);
    for (let i = 0; i < p.length; i += 3) { this.pos.push(p[i], p[i + 1], p[i + 2]); this.col.push(c.r, c.g, c.b); }
    g.dispose();
  }
  build(withColor = true, withUV = false) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    if (withColor && this.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (withUV && this.uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _n = new THREE.Vector3();
function normalOf(a, b, c) { return _n.crossVectors(_e1.subVectors(b, a), _e2.subVectors(c, a)); }

const M = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

// section points for the left half (x >= 0), bottom centre -> top centre
function lowerPts(s) {
  const q3y = s.belt - 0.1;
  const yb = Math.min(s.yb, q3y - 0.03);
  return [
    new THREE.Vector3(0, yb, s.z),
    new THREE.Vector3(Math.max(0.05, s.w - 0.1), yb, s.z),
    new THREE.Vector3(s.w, Math.min(yb + 0.14, q3y - 0.015), s.z),
    new THREE.Vector3(s.w, q3y, s.z),
  ];
}
function upperPts(s) {
  const crown = s.kind === 'c' ? 0.025 : 0.035;
  return [
    new THREE.Vector3(s.w, s.belt - 0.1, s.z),
    new THREE.Vector3(s.w - 0.03, s.belt, s.z),
    new THREE.Vector3(s.wt, s.top, s.z),
    new THREE.Vector3(0, s.top + crown, s.z),
  ];
}

function interpStation(st, z) {
  for (let i = 0; i + 1 < st.length; i++) {
    const a = st[i], b = st[i + 1];
    if (z <= a.z && z >= b.z) {
      const t = (a.z - z) / (a.z - b.z || 1);
      const L = (k) => a[k] + (b[k] - a[k]) * t;
      return { z, top: L('top'), w: L('w'), wt: L('wt'), belt: L('belt'), yb: L('yb'), kind: t < 0.5 ? a.kind : b.kind };
    }
  }
  return { ...st[st.length - 1], z };
}

// Build the body loft into three soups: paint (uv), trim (colour), glass.
function loft(def, colors) {
  const st = def.stations.slice().sort((a, b) => b.z - a.z);
  const zF = st[0].z, zR = st[st.length - 1].z;
  const paint = new Soup(), trim = new Soup(), glass = new Soup();
  const trimC = new THREE.Color(colors.detail);
  const halfW = 1.0;

  const addPaintTri = (a, b, c) => {
    const n = normalOf(a, b, c).normalize();
    let uvs;
    if (Math.abs(n.x) >= 0.5) {
      const side = n.x > 0 ? 1 : -1;
      uvs = [a, b, c].map((p) => sideUV(side, p.z, p.y, zF, zR));
    } else if (n.y >= 0.35) uvs = [a, b, c].map((p) => topUV(p.x, p.z, zF, zR, halfW));
    else uvs = [a, b, c].map((p) => endUV(p.x, p.y, halfW));
    paint.tri(a, b, c, null, uvs);
  };
  const put = (mat, a, b, c) => {
    if (mat === 'paint') addPaintTri(a, b, c);
    else if (mat === 'glass') glass.tri(a, b, c);
    else trim.tri(a, b, c, trimC);
  };
  // quad with outward check: the body is roughly convex around its long axis
  const quad = (mat, a, b, c, d) => {
    const cx = (a.x + b.x + c.x + d.x) / 4, cy = (a.y + b.y + c.y + d.y) / 4;
    const want = new THREE.Vector3(cx, (cy - 0.6) * 0.9, 0);
    const area = normalOf(a, b, c).length() + normalOf(a, c, d).length();
    if (area < 1e-7) return;
    let n = normalOf(a, b, c).clone().add(normalOf(a, c, d));
    if (n.dot(want) < 0) { const t = b; b = d; d = t; }
    put(mat, a, b, c); put(mat, a, c, d);
  };
  const mirror = (v) => new THREE.Vector3(-v.x, v.y, v.z);

  // --- lower loft on fine stations (with wheel arches) ---------------------
  let fine = st.slice();
  if (def.arches) {
    for (const wz of [1.34, -1.3]) {
      const prof = [[0.56, 0], [0.44, 0.58], [0.26, 0.88], [0, 1], [-0.26, 0.88], [-0.44, 0.58], [-0.56, 0]];
      for (const [dz, k] of prof) {
        const s = interpStation(st, wz + dz);
        const apex = s.belt - 0.13;
        s.yb = s.yb + (Math.max(s.yb, apex) - s.yb) * k;
        s.arch = k > 0;
        fine.push(s);
      }
    }
    fine.sort((a, b) => b.z - a.z);
    // drop duplicates
    fine = fine.filter((s, i) => i === 0 || Math.abs(s.z - fine[i - 1].z) > 1e-3);
  }
  const lowerMat = ['trim', def.rocker === 'paint' ? 'paint' : 'trim', 'paint'];
  for (let i = 0; i + 1 < fine.length; i++) {
    const A = lowerPts(fine[i]), B = lowerPts(fine[i + 1]);
    for (let k = 0; k < 3; k++) {
      quad(lowerMat[k], A[k], B[k], B[k + 1], A[k + 1]);
      quad(lowerMat[k], mirror(A[k]), mirror(B[k]), mirror(B[k + 1]), mirror(A[k + 1]));
    }
  }
  // arch inner walls: dark wheel-well liners behind each arch
  // --- upper loft on base stations --------------------------------------------
  for (let i = 0; i + 1 < st.length; i++) {
    const a = st[i], b = st[i + 1];
    const A = upperPts(a), B = upperPts(b);
    const cc = a.kind === 'c' && b.kind === 'c';
    const trans = (a.kind === 'c') !== (b.kind === 'c');
    const mats = ['paint', cc ? 'glass' : trans ? 'trim' : 'paint', cc ? 'paint' : trans ? 'glass' : 'paint'];
    for (let k = 0; k < 3; k++) {
      quad(mats[k], A[k], B[k], B[k + 1], A[k + 1]);
      quad(mats[k], mirror(A[k]), mirror(B[k]), mirror(B[k + 1]), mirror(A[k + 1]));
    }
  }
  // --- end caps -----------------------------------------------------------------
  for (const [s, dir] of [[st[0], 1], [st[st.length - 1], -1]]) {
    const ring = [...lowerPts(s), ...upperPts(s).slice(1)];
    const full = [...ring, ...ring.slice(1, -1).reverse().map(mirror)];
    const c = new THREE.Vector3(0, (s.yb + s.top) / 2, s.z);
    for (let i = 0; i < full.length; i++) {
      const p = full[i], q = full[(i + 1) % full.length];
      let a = c, b = p, d = q;
      if (normalOf(a, b, d).z * dir < 0) { const t = b; b = d; d = t; }
      if (normalOf(a, b, d).lengthSq() > 1e-9) put('paint', a, b, d);
    }
  }
  return { paint, trim, glass, st, zF, zR };
}

// ---- wheels -------------------------------------------------------------------
function wheelGeometry(style, rimColor) {
  const s = new Soup();
  const R = WHEEL_R, W = 0.28;
  const tread = 0x1b1c20, wall = 0x2b2c31;
  const rim = new THREE.Color(rimColor);
  const rimDark = rim.clone().multiplyScalar(0.45);
  const rotZ = M(0, 0, 0, 0, 0, -Math.PI / 2);
  s.addGeometry(new THREE.CylinderGeometry(R, R, W, 16, 1, true), tread, rotZ);
  // sidewalls
  const ring = new THREE.RingGeometry(0.235, R, 16, 1);
  s.addGeometry(ring, wall, M(W / 2, 0, 0, 0, Math.PI / 2, 0));
  s.addGeometry(ring, wall, M(-W / 2, 0, 0, 0, -Math.PI / 2, 0));
  // rim barrel + face
  s.addGeometry(new THREE.CylinderGeometry(0.235, 0.235, W * 0.8, 14, 1, true), rimDark.getHex(), rotZ);
  s.addGeometry(new THREE.CircleGeometry(0.235, 14), rimDark.getHex(), M(0.06, 0, 0, 0, Math.PI / 2, 0));
  s.addGeometry(new THREE.RingGeometry(0.2, 0.238, 14, 1), rim.getHex(), M(W / 2 - 0.005, 0, 0, 0, Math.PI / 2, 0));
  const spoke = (n, w, depth = 0.04, twist = 0, len = 0.2) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      s.addGeometry(new THREE.BoxGeometry(depth, len, w), rim.getHex(), M(0.105, Math.cos(a) * 0.105, Math.sin(a) * 0.105, a + twist, 0, 0));
    }
  };
  switch (style) {
    case 'mesh': spoke(10, 0.028, 0.03); spoke(10, 0.028, 0.03, 0.35); break;
    case 'disc': s.addGeometry(new THREE.CircleGeometry(0.21, 12), rim.getHex(), M(0.125, 0, 0, 0, Math.PI / 2, 0)); break;
    case 'spoke3': spoke(3, 0.085, 0.05); break;
    case 'turbine': for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; s.addGeometry(new THREE.BoxGeometry(0.02, 0.19, 0.06), rim.getHex(), M(0.11, Math.cos(a) * 0.12, Math.sin(a) * 0.12, a, 0.6, 0)); } break;
    case 'classic': {
      s.addGeometry(new THREE.CircleGeometry(0.2, 12), rim.getHex(), M(0.1, 0, 0, 0, Math.PI / 2, 0));
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; s.addGeometry(new THREE.CircleGeometry(0.035, 6), 0x111111, M(0.103, Math.cos(a) * 0.13, Math.sin(a) * 0.13, 0, Math.PI / 2, 0)); }
      break;
    }
    default: spoke(5, 0.055, 0.045);
  }
  s.addGeometry(new THREE.CylinderGeometry(0.055, 0.065, 0.06, 8), rim.clone().multiplyScalar(0.8).getHex(), M(0.12, 0, 0, 0, 0, -Math.PI / 2));
  return s.build(true);
}

// ---- the car ------------------------------------------------------------------
export function buildCar(custom = DEFAULT_CAR, { envMap = null, shadows = true } = {}) {
  const c = { ...DEFAULT_CAR, ...custom };
  const def = BODIES[c.body] || BODIES.bolt;
  const root = new THREE.Group();
  root.name = 'car';
  const body = new THREE.Group();
  body.position.y = -CG_Y;
  root.add(body);

  // livery texture
  let canvas = null, tex = null;
  if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
    canvas.width = canvas.height = ATLAS;
    paintLivery(canvas, c);
    tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
  }
  const fin = FINISHES[c.finish] || FINISHES.gloss;
  const paintMat = fin.iridescence
    ? new THREE.MeshPhysicalMaterial({ map: tex, roughness: fin.rough, metalness: fin.metal, envMap, envMapIntensity: fin.env, flatShading: true, iridescence: 0.9, iridescenceIOR: 1.6, clearcoat: 0.6, clearcoatRoughness: 0.2 })
    : new THREE.MeshStandardMaterial({ map: tex, roughness: fin.rough, metalness: fin.metal, envMap, envMapIntensity: fin.env, flatShading: true });
  if (!tex) paintMat.color.set(c.paint);
  const trimMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25, envMap, envMapIntensity: 0.6, flatShading: true });
  const glassMat = new THREE.MeshStandardMaterial({ color: TINTS[c.tint] ?? TINTS.dark, roughness: 0.06, metalness: 0.5, envMap, envMapIntensity: 1.4, flatShading: true });
  const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true });

  const L = loft(def, c);
  const extras = new Soup(); // trim-coloured bolt-ons (vertex colours)
  const lights = new Soup();
  const st = L.st, zF = L.zF, zR = L.zR;
  const front = st[0], rear = st[st.length - 1];
  const f2 = st[1], r2 = st[st.length - 2];
  const accent = new THREE.Color(c.accent).getHex();
  const detail = new THREE.Color(c.detail).getHex();
  const paintHex = new THREE.Color(c.paint).getHex();
  const chromeHex = 0xdfe3ea;
  const box = (soup, col, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) =>
    soup.addGeometry(new THREE.BoxGeometry(sx, sy, sz), col, M(x, y, z, rx, ry, rz));
  const both = (fn) => { fn(1); fn(-1); };
  const hl = new THREE.Color(0xfff6e0).multiplyScalar(3.2).getHex();
  const tl = 0xff2a1a;

  // headlights
  const fy = (front.belt + front.yb) / 2 + 0.05;
  switch (def.lights.front) {
    case 'wide': both((sx) => { box(lights, 0xffffff, sx * (front.w - 0.3), fy + 0.02, zF - 0.02, 0.36, 0.08, 0.12, 0.25, 0, 0); box(extras, detail, sx * (front.w - 0.3), fy + 0.02, zF - 0.035, 0.42, 0.13, 0.12, 0.25); }); break;
    case 'slit': both((sx) => box(lights, 0xffffff, sx * (front.w - 0.26), fy + 0.04, zF - 0.1, 0.46, 0.05, 0.3, 0.45, sx * 0.15, 0)); break;
    case 'round': both((sx) => { lights.addGeometry(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 10), 0xffffff, M(sx * (front.w - 0.27), fy, zF + 0.0, Math.PI / 2, 0, 0)); extras.addGeometry(new THREE.CylinderGeometry(0.125, 0.125, 0.05, 10), c.body === 'retro' ? chromeHex : detail, M(sx * (front.w - 0.27), fy, zF - 0.01, Math.PI / 2, 0, 0)); }); break;
    case 'quad': both((sx) => { for (const k of [0, 1]) lights.addGeometry(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 8), 0xffffff, M(sx * (front.w - 0.2 - k * 0.2), fy, zF + 0.005, Math.PI / 2, 0, 0)); }); box(extras, detail, 0, fy, zF - 0.01, front.w * 2 - 0.1, 0.2, 0.04); break;
    case 'bar': box(lights, 0xffffff, 0, fy + 0.08, zF + 0.0, front.w * 1.9, 0.04, 0.05); break;
    default: break;
  }
  // colour the light soup: everything so far is headlight
  for (let i = 0; i < lights.col.length; i += 3) { const h = new THREE.Color(hl); lights.col[i] = h.r; lights.col[i + 1] = h.g; lights.col[i + 2] = h.b; }
  const tailStart = lights.col.length;
  // taillights
  const ry = rear.belt - 0.12;
  switch (def.lights.rear) {
    case 'bar': box(lights, tl, 0, ry, zR + 0.0, rear.w * 1.8, 0.07, 0.05); break;
    case 'pair': both((sx) => box(lights, tl, sx * (rear.w - 0.2), ry, zR + 0.0, 0.26, 0.14, 0.05)); break;
    case 'round': both((sx) => { for (const k of [0, 1]) lights.addGeometry(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 8), tl, M(sx * (rear.w - 0.18 - k * 0.2), ry, zR, Math.PI / 2, 0, 0)); }); break;
    case 'rain': box(lights, tl, 0, 0.62, zR - 0.02, 0.12, 0.08, 0.05); break;
    default: break;
  }
  for (let i = tailStart; i < lights.col.length; i += 3) { lights.col[i] = 2.6; lights.col[i + 1] = 0.12; lights.col[i + 2] = 0.08; }

  if (!def.open) {
    // grille + lower intake
    box(extras, detail, 0, front.yb + 0.12, zF + 0.0, front.w * 1.2, 0.14, 0.04);
    // rear diffuser / bumper trim
    box(extras, detail, 0, rear.yb + 0.08, zR - 0.0, rear.w * 1.6, 0.12, 0.05);
  }
  // mirrors
  if (def.mirrors) {
    const a = st.find((s) => s.kind === 'c');
    const aIdx = st.indexOf(a);
    const hs = st[aIdx - 1];
    const mz = hs.z - 0.22, my = hs.belt + 0.07;
    both((sx) => {
      box(extras, detail, sx * (hs.w + 0.02), my - 0.04, mz + 0.03, 0.1, 0.035, 0.07); // stalk into the door
      box(extras, paintHex, sx * (hs.w + 0.1), my, mz, 0.1, 0.09, 0.16, 0, sx * 0.25, 0);
      box(extras, 0x9fb4c8, sx * (hs.w + 0.1), my, mz - 0.085, 0.08, 0.07, 0.01, 0, sx * 0.25, 0); // glass
    });
  }
  // exhausts
  for (let i = 0; i < (def.exhaust || 0); i++) {
    const x = def.exhaust === 1 ? 0.45 : i === 0 ? 0.45 : -0.45;
    extras.addGeometry(new THREE.CylinderGeometry(0.055, 0.055, 0.18, 8), 0x9aa0a8, M(x, rear.yb + 0.08, zR - 0.02, Math.PI / 2, 0, 0));
  }
  // bonnet / roof scoops, intakes
  if (def.hoodScoop) box(extras, detail, 0, st[2].top + 0.05, (st[2].z + st[3].z) / 2, 0.5, 0.12, 0.7, -0.05);
  if (def.scoop) { const r = st.find((s) => s.kind === 'c'); box(extras, paintHex, 0, r.top + 0.06, r.z - 0.25, 0.4, 0.1, 0.4); box(extras, detail, 0, r.top + 0.06, r.z - 0.04, 0.34, 0.06, 0.02); }
  if (def.intake) both((sx) => box(extras, detail, sx * 0.97, 0.62, -0.95, 0.04, 0.2, 0.55, 0, sx * 0.1, 0));
  if (def.mudflaps) both((sx) => { box(extras, detail, sx * 0.8, 0.2, -1.84, 0.3, 0.3, 0.02); box(extras, detail, sx * 0.8, 0.2, 0.8, 0.3, 0.26, 0.02); });

  // spoilers
  const deck = st.slice().reverse().find((s) => s.kind === 'h' && s.z > zR + 0.1) || rear;
  const deckY = deck.top;
  const wingC = c.accent ? accent : paintHex;
  if (!def.open) {
    switch (c.spoiler) {
      case 'lip': box(extras, detail, 0, deckY + 0.04, deck.z + 0.02, deck.w * 1.7, 0.035, 0.2, -0.3); break;
      case 'duck': box(extras, paintHex, 0, deckY + 0.05, deck.z + 0.05, deck.w * 1.8, 0.06, 0.28, -0.35); break;
      case 'wing': both((sx) => box(extras, detail, sx * 0.55, deckY + 0.13, deck.z + 0.12, 0.05, 0.26, 0.14));
        box(extras, wingC, 0, deckY + 0.27, deck.z + 0.08, 1.7, 0.045, 0.34, -0.12); break;
      case 'gt': both((sx) => box(extras, detail, sx * 0.5, deckY + 0.24, deck.z + 0.15, 0.05, 0.48, 0.14, 0.1));
        box(extras, wingC, 0, deckY + 0.5, deck.z + 0.05, 1.95, 0.05, 0.42, -0.14);
        both((sx) => box(extras, detail, sx * 0.99, deckY + 0.5, deck.z + 0.05, 0.03, 0.24, 0.5)); break;
      default: break;
    }
  }
  // formula bits
  if (def.formula) {
    box(extras, wingC, 0, 0.16, 2.2, 1.9, 0.04, 0.4, 0.05);
    both((sx) => box(extras, detail, sx * 0.95, 0.24, 2.15, 0.03, 0.22, 0.5));
    box(extras, wingC, 0, 1.05, -2.02, 1.3, 0.05, 0.36, -0.15);
    box(extras, wingC, 0, 0.9, -2.02, 1.3, 0.04, 0.24, -0.25);
    both((sx) => box(extras, detail, sx * 0.66, 0.85, -2.0, 0.03, 0.5, 0.5));
    box(extras, detail, 0, 0.72, -1.85, 0.08, 0.5, 0.12);
    both((sx) => box(extras, paintHex, sx * 0.62, 0.42, -0.55, 0.42, 0.3, 1.25, 0, 0, 0));
    extras.addGeometry(new THREE.IcosahedronGeometry(0.17, 1), accent, M(0, 0.9, -0.2));
    extras.addGeometry(new THREE.TorusGeometry(0.3, 0.025, 4, 12, Math.PI), detail, M(0, 0.86, 0.02, 0, 0, 0, 1, 1, 1.2));
    box(extras, detail, 0, 0.94, 0.3, 0.05, 0.2, 0.05, 0.4);
  }
  if (def.buggy) {
    const cage = (x0, y0, z0, x1, y1, z1) => {
      const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1);
      const len = a.distanceTo(b);
      const g = new THREE.CylinderGeometry(0.04, 0.04, len, 5);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      extras.addGeometry(g, detail, new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
    };
    both((sx) => {
      cage(sx * 0.62, 0.74, 0.7, sx * 0.5, 1.42, 0.05);
      cage(sx * 0.5, 1.42, 0.05, sx * 0.5, 1.42, -1.0);
      cage(sx * 0.5, 1.42, -1.0, sx * 0.62, 0.8, -1.6);
      cage(sx * 0.62, 0.8, -1.2, sx * 0.5, 1.42, -1.0);
    });
    cage(0.5, 1.42, 0.05, -0.5, 1.42, 0.05);
    cage(0.5, 1.42, -1.0, -0.5, 1.42, -1.0);
    cage(0.55, 0.5, 2.05, -0.55, 0.5, 2.05);
    both((sx) => cage(sx * 0.55, 0.5, 2.05, sx * 0.6, 0.66, 1.7));
    extras.addGeometry(new THREE.IcosahedronGeometry(0.17, 1), accent, M(0, 1.1, -0.45));
    box(extras, detail, 0, 0.86, -0.55, 0.55, 0.36, 0.1);
    box(extras, 0x3a3d44, 0, 0.9, -1.45, 0.7, 0.3, 0.4);
    extras.addGeometry(new THREE.CylinderGeometry(0.28, 0.28, 0.16, 12), 0x1b1c20, M(0, 1.02, -1.78, Math.PI / 2 - 0.3, 0, 0));
  }

  const mk = (geo, mat, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadows && cast;
    m.receiveShadow = false;
    body.add(m);
    return m;
  };
  mk(L.paint.build(false, true), paintMat);
  const trimGeo = mergeSoups([L.trim, extras]);
  mk(trimGeo, trimMat);
  mk(L.glass.build(false), glassMat);
  if (lights.pos.length) mk(lights.build(true), lightMat, false);

  // underglow
  let glow = null;
  if (c.underglow && c.underglow !== 'none') {
    const gc = document.createElement('canvas');
    gc.width = gc.height = 64;
    const g2 = gc.getContext('2d');
    const grd = g2.createRadialGradient(32, 32, 4, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g2.fillStyle = grd; g2.fillRect(0, 0, 64, 64);
    const gt = new THREE.CanvasTexture(gc);
    glow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 5.6), new THREE.MeshBasicMaterial({ map: gt, color: new THREE.Color(c.underglow).multiplyScalar(2.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.03;
    body.add(glow);
  }

  // wheels
  const wgeo = wheelGeometry(c.rim, c.rimColor);
  const wmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.45, envMap, envMapIntensity: 0.8, flatShading: true });
  const wheels = CAR_SPEC.wheels.map((w) => {
    const pivot = new THREE.Group();
    pivot.position.set(w.x, -0.3 + 0.087, w.z);
    const spin = new THREE.Mesh(wgeo, wmat);
    spin.castShadow = shadows;
    if (w.x < 0) spin.scale.x = -1;
    pivot.add(spin);
    root.add(pivot);
    return { pivot, spin, front: w.front };
  });

  const materials = [paintMat, trimMat, glassMat, lightMat, wmat];
  if (glow) materials.push(glow.material);
  const api = {
    group: root, body, wheels, materials, custom: c, glow,
    // copy wheel state from a physics car (or a remote snapshot)
    syncWheels(wheelStates) {
      for (let i = 0; i < 4; i++) {
        const ws = wheelStates[i], w = wheels[i];
        w.pivot.position.y = -0.3 + Math.min(ws.comp, 0.3);
        w.pivot.rotation.y = ws.steerAngle || 0;
        w.spin.rotation.x = ws.spin;
      }
    },
    setOpacity(a) {
      for (const m of materials) {
        m.transparent = a < 1;
        m.opacity = a;
        m.depthWrite = a >= 1;
        m.needsUpdate = true;
      }
    },
    dispose() {
      root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      for (const m of materials) { if (m.map) m.map.dispose(); m.dispose(); }
    },
  };
  return api;
}

function mergeSoups(soups) {
  const s = new Soup();
  for (const x of soups) { s.pos.push(...x.pos); s.col.push(...x.col); }
  return s.build(true);
}
