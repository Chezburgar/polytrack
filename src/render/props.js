// Procedural low-poly props. Each returns a non-indexed BufferGeometry with
// baked vertex colours (trunk vs leaves etc.), flat-shaded, sitting on y=0.
import * as THREE from 'three';

class GeoBuilder {
  constructor() { this.pos = []; this.col = []; }
  add(geo, color, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], jitter = 0, rnd = Math.random, tint = null } = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...pos),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
      new THREE.Vector3(...scale),
    );
    g.applyMatrix4(m);
    const p = g.attributes.position.array;
    if (jitter) {
      // move shared corners consistently so the mesh stays watertight
      const map = new Map();
      for (let i = 0; i < p.length; i += 3) {
        const k = `${p[i].toFixed(3)},${p[i + 1].toFixed(3)},${p[i + 2].toFixed(3)}`;
        let d = map.get(k);
        if (!d) { d = [(rnd() - 0.5) * jitter, (rnd() - 0.5) * jitter, (rnd() - 0.5) * jitter]; map.set(k, d); }
        p[i] += d[0]; p[i + 1] += d[1]; p[i + 2] += d[2];
      }
    }
    const c = new THREE.Color(color);
    for (let i = 0; i < p.length; i += 9) {
      const k = tint ? 1 + (rnd() - 0.5) * tint : 1;
      for (let v = 0; v < 3; v++) {
        this.pos.push(p[i + v * 3], p[i + v * 3 + 1], p[i + v * 3 + 2]);
        this.col.push(c.r * k, c.g * k, c.b * k);
      }
    }
    g.dispose();
    return this;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

const cyl = (rt, rb, h, s) => new THREE.CylinderGeometry(rt, rb, h, s, 1);
const cone = (r, h, s) => new THREE.ConeGeometry(r, h, s, 1);
const ico = (r, d = 0) => new THREE.IcosahedronGeometry(r, d);

export function makeProp(kind, rnd, pal = {}) {
  const b = new GeoBuilder();
  const trunk = pal.trunk ?? 0x7a5234;
  const leaf = pal.leaf ?? 0x3f8f3a;
  const leaf2 = pal.leaf2 ?? 0x57a843;
  switch (kind) {
    case 'oak': {
      b.add(cyl(0.22, 0.34, 2.6, 6), trunk, { pos: [0, 1.3, 0] });
      b.add(ico(2.0), leaf, { pos: [0, 3.8, 0], scale: [1.1, 0.95, 1.1], jitter: 0.5, rnd, tint: 0.14 });
      b.add(ico(1.35), leaf2, { pos: [0.9, 4.6, 0.4], jitter: 0.35, rnd, tint: 0.14 });
      b.add(ico(1.2), leaf2, { pos: [-0.9, 3.4, -0.6], jitter: 0.3, rnd, tint: 0.14 });
      break;
    }
    case 'autumn': {
      b.add(cyl(0.2, 0.32, 2.4, 6), 0x5e3f2a, { pos: [0, 1.2, 0] });
      b.add(ico(1.9), pal.leaf ?? 0xd9772b, { pos: [0, 3.6, 0], scale: [1.05, 1, 1.05], jitter: 0.5, rnd, tint: 0.2 });
      b.add(ico(1.3), pal.leaf2 ?? 0xe8b23a, { pos: [0.8, 4.5, -0.3], jitter: 0.35, rnd, tint: 0.2 });
      break;
    }
    case 'redtree': {
      b.add(cyl(0.2, 0.32, 2.5, 6), 0x5a3a2a, { pos: [0, 1.25, 0] });
      b.add(ico(1.8), 0xc0392b, { pos: [0, 3.7, 0], scale: [1.1, 1, 1.1], jitter: 0.5, rnd, tint: 0.2 });
      b.add(ico(1.25), 0xe0603a, { pos: [-0.8, 4.4, 0.3], jitter: 0.35, rnd, tint: 0.2 });
      break;
    }
    case 'pine': {
      b.add(cyl(0.18, 0.28, 1.8, 5), trunk, { pos: [0, 0.9, 0] });
      b.add(cone(2.0, 3.2, 7), leaf, { pos: [0, 2.9, 0], tint: 0.12, rnd });
      b.add(cone(1.55, 2.7, 7), leaf2, { pos: [0, 4.4, 0], rot: [0, 0.4, 0], tint: 0.12, rnd });
      b.add(cone(1.0, 2.2, 7), leaf, { pos: [0, 5.8, 0], rot: [0, 0.8, 0], tint: 0.12, rnd });
      break;
    }
    case 'snowpine': {
      b.add(cyl(0.18, 0.28, 1.8, 5), 0x5d4633, { pos: [0, 0.9, 0] });
      b.add(cone(2.0, 3.2, 7), 0x2f6b4f, { pos: [0, 2.9, 0] });
      b.add(cone(1.62, 1.1, 7), 0xf2f7fb, { pos: [0, 3.95, 0] });
      b.add(cone(1.5, 2.6, 7), 0x2f6b4f, { pos: [0, 4.5, 0], rot: [0, 0.4, 0] });
      b.add(cone(1.18, 0.9, 7), 0xf2f7fb, { pos: [0, 5.35, 0], rot: [0, 0.4, 0] });
      b.add(cone(0.9, 1.9, 7), 0xeef4f8, { pos: [0, 6.2, 0], rot: [0, 0.8, 0] });
      break;
    }
    case 'bush': {
      b.add(ico(0.95), leaf2, { pos: [0, 0.55, 0], scale: [1.3, 0.8, 1.2], jitter: 0.25, rnd, tint: 0.16 });
      b.add(ico(0.7), leaf, { pos: [0.7, 0.45, 0.3], jitter: 0.2, rnd, tint: 0.16 });
      break;
    }
    case 'rock': {
      const c = pal.rock ?? 0x8b8f96;
      b.add(ico(1.0), c, { pos: [0, 0.45, 0], scale: [1.5, 0.95, 1.2], jitter: 0.45, rnd, tint: 0.18 });
      break;
    }
    case 'boulder': {
      const c = pal.rock ?? 0x8b8f96;
      b.add(ico(1.0), c, { pos: [0, 0.9, 0], scale: [2.6, 2.0, 2.2], jitter: 0.6, rnd, tint: 0.16 });
      b.add(ico(1.0), c, { pos: [1.6, 0.5, 0.8], scale: [1.3, 1.0, 1.1], jitter: 0.35, rnd, tint: 0.16 });
      break;
    }
    case 'tuft': {
      for (let i = 0; i < 4; i++) {
        const a = rnd() * Math.PI * 2, r = rnd() * 0.5;
        b.add(cone(0.16, 0.7 + rnd() * 0.4, 4), i % 2 ? leaf : leaf2, { pos: [Math.cos(a) * r, 0.35, Math.sin(a) * r], rot: [(rnd() - 0.5) * 0.4, 0, (rnd() - 0.5) * 0.4] });
      }
      break;
    }
    case 'flower': {
      const cols = pal.flowers ?? [0xf05a5a, 0xffd54a, 0xffffff, 0xb77cf0];
      for (let i = 0; i < 5; i++) {
        const a = rnd() * Math.PI * 2, r = rnd() * 0.8;
        b.add(cyl(0.02, 0.02, 0.4, 3), 0x3c7a2f, { pos: [Math.cos(a) * r, 0.2, Math.sin(a) * r] });
        b.add(ico(0.12), cols[Math.floor(rnd() * cols.length)], { pos: [Math.cos(a) * r, 0.43, Math.sin(a) * r] });
      }
      break;
    }
    case 'palm': {
      const segs = 6;
      let x = 0, y = 0;
      const lean = 0.08 + rnd() * 0.06;
      for (let i = 0; i < segs; i++) {
        const r0 = 0.26 - i * 0.02;
        b.add(cyl(r0 - 0.03, r0, 1.2, 6), i % 2 ? 0x8c6a43 : 0x9d7a4f, { pos: [x, y + 0.6, 0], rot: [0, 0, -lean * i] });
        x += Math.sin(lean * i) * 1.2;
        y += Math.cos(lean * i) * 1.15;
      }
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        const leafG = new THREE.BufferGeometry();
        const L = 3.2;
        const v = new Float32Array([0, 0, 0, L, -0.9, 0.55, L, -0.9, -0.55, 0, 0, 0, L, -0.9, -0.55, L, -0.9, 0.55]);
        leafG.setAttribute('position', new THREE.BufferAttribute(v, 3));
        b.add(leafG, k % 2 ? 0x3f9a3a : 0x2f8a35, { pos: [x, y, 0], rot: [0, a, 0.25] });
      }
      b.add(ico(0.35), 0x6b4a2a, { pos: [x, y - 0.2, 0] });
      break;
    }
    case 'cactus': {
      const c = 0x4f8f4a;
      const h = 3 + rnd() * 1.5;
      b.add(cyl(0.34, 0.38, h, 7), c, { pos: [0, h / 2, 0] });
      b.add(ico(0.34), c, { pos: [0, h, 0], scale: [1, 0.6, 1] });
      for (const s of [-1, 1]) {
        if (rnd() < 0.3) continue;
        const ay = 1.2 + rnd() * 1.2;
        b.add(cyl(0.22, 0.22, 0.8, 6), c, { pos: [s * 0.6, ay, 0], rot: [0, 0, Math.PI / 2] });
        b.add(cyl(0.22, 0.22, 1.3, 6), c, { pos: [s * 1.0, ay + 0.6, 0] });
        b.add(ico(0.22), c, { pos: [s * 1.0, ay + 1.25, 0], scale: [1, 0.6, 1] });
      }
      break;
    }
    case 'deadtree': {
      const c = pal.trunk ?? 0x4a3b33;
      b.add(cyl(0.14, 0.3, 4, 5), c, { pos: [0, 2, 0] });
      for (let i = 0; i < 4; i++) {
        const a = rnd() * Math.PI * 2;
        b.add(cyl(0.05, 0.11, 1.8, 4), c, { pos: [Math.cos(a) * 0.5, 2.6 + i * 0.4, Math.sin(a) * 0.5], rot: [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9] });
      }
      break;
    }
    case 'crystal': {
      const c = pal.crystal ?? 0x7fe3ff;
      b.add(new THREE.OctahedronGeometry(0.8, 0), c, { pos: [0, 1.6, 0], scale: [0.8, 2.4, 0.8], tint: 0.2, rnd });
      b.add(new THREE.OctahedronGeometry(0.5, 0), c, { pos: [0.7, 0.8, 0.3], rot: [0, 0, -0.5], scale: [0.7, 1.9, 0.7], tint: 0.2, rnd });
      b.add(new THREE.OctahedronGeometry(0.45, 0), c, { pos: [-0.6, 0.7, -0.2], rot: [0.3, 0, 0.6], scale: [0.7, 1.7, 0.7], tint: 0.2, rnd });
      break;
    }
    case 'mesa': {
      const layers = [0xc9764a, 0xb5613c, 0xd98e5a, 0xa8553a];
      let y = 0;
      const r = 1;
      for (let i = 0; i < 4; i++) {
        const h = 0.25 + rnd() * 0.1;
        const rr = r * (1 - i * 0.06);
        b.add(cyl(rr * 0.97, rr, h, 8), layers[i % layers.length], { pos: [0, y + h / 2, 0], jitter: 0.04, rnd });
        y += h;
      }
      break;
    }
    case 'iceberg': {
      b.add(ico(1.0), 0xe8f6ff, { pos: [0, 0.3, 0], scale: [2.2, 1.6, 1.9], jitter: 0.5, rnd, tint: 0.08 });
      break;
    }
    case 'lamp': {
      b.add(cyl(0.08, 0.12, 6, 5), 0x3a3f48, { pos: [0, 3, 0] });
      b.add(new THREE.BoxGeometry(1.2, 0.12, 0.25), 0x3a3f48, { pos: [0.55, 6, 0] });
      break;
    }
    default:
      b.add(ico(1), 0xff00ff, {});
  }
  return b.build();
}

// Grandstand with a crowd: stepped seating, back wall and roof.
export function makeGrandstand(rnd, len = 30, colors = [0x2f6fd6, 0xe8433a, 0xffd23c, 0xf5f5f5, 0x3bbf6a]) {
  const b = new GeoBuilder();
  const rows = 6;
  for (let r = 0; r < rows; r++) {
    const y = r * 0.6, z = -r * 0.9;
    b.add(new THREE.BoxGeometry(len, 0.6, 0.9), r % 2 ? 0xb7bcc6 : 0xa6abb5, { pos: [0, y + 0.3, z] });
    // spectators as little coloured blocks
    for (let x = -len / 2 + 0.6; x < len / 2 - 0.4; x += 0.7 + rnd() * 0.3) {
      if (rnd() < 0.18) continue;
      const c = colors[Math.floor(rnd() * colors.length)];
      b.add(new THREE.BoxGeometry(0.38, 0.55, 0.3), c, { pos: [x, y + 0.88, z - 0.1] });
      b.add(new THREE.BoxGeometry(0.24, 0.24, 0.24), 0xf0c9a0, { pos: [x, y + 1.3, z - 0.1] });
    }
  }
  b.add(new THREE.BoxGeometry(len, rows * 0.6 + 3, 0.3), 0x8d929c, { pos: [0, (rows * 0.6 + 3) / 2, -rows * 0.9 - 0.2] });
  b.add(new THREE.BoxGeometry(len + 1, 0.25, rows * 0.9 + 2), 0xe8e8e8, { pos: [0, rows * 0.6 + 3.2, -rows * 0.45 + 0.4], rot: [-0.08, 0, 0] });
  for (const x of [-len / 2, 0, len / 2]) b.add(new THREE.BoxGeometry(0.3, rows * 0.6 + 3.2, 0.3), 0x6c717a, { pos: [x, (rows * 0.6 + 3.2) / 2, 0.8] });
  return b.build();
}

export { GeoBuilder };
