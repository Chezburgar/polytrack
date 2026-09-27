// A real town around a track, from map data (src/track/maps/*.js): building
// footprints raised to their heights (window bands on the towers, hip roofs on
// the houses), the side streets, parks and pitches laid on the ground, street
// name signs and a sign at the school. Anything the race road runs over is left
// out. Also answers "is this spot taken?" so trees don't grow inside houses.
import * as THREE from 'three';
import { clamp } from '../util/math.js';

const KINDS = [
  // walls, trim/glass, roof
  { walls: [0xf0ece4, 0xd8c8a8, 0xa0523c, 0x9aa6b0, 0xe8dca0, 0xc8b8a0], roofs: [0x4a4a50, 0x5a4a40, 0x3a4048, 0x6a5a50] }, // house
  { walls: [0xa85a40, 0xd8c4a0, 0xe0dcd4, 0xb8a890, 0x9a5a48], glass: 0x5a6878 }, // apartments
  { walls: [0xc8c4bc, 0xd8d4cc, 0x8a9aa8, 0xb0b8c0], glass: 0x4a6a8a }, // office
  { walls: [0xb0604a, 0xe0d0b0, 0xc8b8a0, 0xd8c8b8, 0x9a7060], glass: 0x3a4450 }, // retail
  { walls: [0xa84a3a, 0xb05440], trim: 0xf0ece0, glass: 0x3a4450 }, // school: red brick
  { walls: [0xb8b4ac, 0xa8a49c], glass: 0x2a2c30 }, // garage
  { walls: [0xd8d0c0, 0xc8c0b0], glass: 0x4a5058 }, // civic
];
const AREA_COLORS = { 1: 0x5f9a42, 2: 0x3fa83a, 3: 0x3a6fa8, 4: 0x8a8a90, 5: 0xc88a5a, 6: 0x9cc86a };

export function buildCityMap(group, track, theme, map, { index, heightAt, rnd }) {
  const H = 0.5; // the data is in half metres
  const pos = [], col = [];
  const c = new THREE.Color();
  const tri = (ax, ay, az, bx, by, bz, cx, cy, cz, color) => {
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    c.set(color);
    for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
  };
  const quad = (a, b, cc, d, color) => { tri(...a, ...b, ...cc, color); tri(...a, ...cc, ...d, color); };
  // a triangle turned to face the sky
  const up = (a, b2, c2) => ((b2[2] - a[2]) * (c2[0] - a[0]) - (b2[0] - a[0]) * (c2[2] - a[2]) >= 0 ? [a, b2, c2] : [a, c2, b2]);
  const triUp = (a, b2, c2, color) => { const [p, q2, r2] = up(a, b2, c2); tri(...p, ...q2, ...r2, color); };
  const pick = (arr, r) => arr[Math.floor(r * arr.length) % arr.length];
  // near the race road? (distance beyond the road's edge)
  const clear = (x, z, m) => { const n = index.nearest(x, z, m + 2); return !n || n.d > m; };

  // ---- occupancy: 2 m cells over the map, for props -----------------------------
  const b = track.bounds, CELL = 2, PAD = 700;
  const ox = b.minX - PAD, oz = b.minZ - PAD;
  const gw = Math.ceil((b.maxX - b.minX + 2 * PAD) / CELL), gh = Math.ceil((b.maxZ - b.minZ + 2 * PAD) / CELL);
  const occ = new Uint8Array(gw * gh);
  const mark = (x, z) => { const i = Math.floor((x - ox) / CELL), j = Math.floor((z - oz) / CELL); if (i >= 0 && j >= 0 && i < gw && j < gh) occ[j * gw + i] = 1; };
  const fillPoly = (pts, grow) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let z = z0 - grow; z <= z1 + grow; z += CELL) for (let x = x0 - grow; x <= x1 + grow; x += CELL) if (inPoly(pts, x, z) || grow > 0 && nearPoly(pts, x, z, grow)) mark(x, z);
  };

  // ---- buildings ----------------------------------------------------------------------
  const roofFlat = [0x8a8a88, 0x6a6a6a, 0x9a9690, 0x5a5c60];
  let n = 0;
  for (const rec of map.BUILDINGS) {
    const h = rec[0] * H, kind = rec[1] >> 1, hip = rec[1] & 1;
    const pts = [];
    for (let i = 2; i < rec.length; i += 2) pts.push([rec[i] * H, rec[i + 1] * H]);
    if (pts.length < 3 || !pts.every(([x, z]) => clear(x, z, 3))) continue;
    // anything whose middle sits on the road is out too
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    if (!clear(cx, cz, 3) || index.roadAbove(cx, cz, 4) !== null) continue;
    fillPoly(pts, 1);
    const r = hash(rec[2] * 31 + rec[3] * 17);
    const K = KINDS[kind] || KINDS[3];
    const wall = pick(K.walls, r), glass = K.glass;
    // stand on the lowest ground under it, so no corner floats
    const base = Math.min(...pts.map(([x, z]) => heightAt(x, z))) - 0.3;
    const top = base + h;
    const cw = ccw(pts);
    const ring = cw ? pts.slice().reverse() : pts;
    // storeys (houses and garages stay plain); shops get a glass shopfront below
    const floors = kind === 0 || kind === 5 ? 0 : Math.max(1, Math.floor(h / 3.4));
    const shop = kind === 3;
    for (let i = 0; i < ring.length; i++) {
      const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % ring.length];
      if (shop) {
        // a glass shopfront, then a band of windows per storey above
        const y1 = base + Math.min(3.6, h * 0.45);
        quad([x0, base, z0], [x1, base, z1], [x1, y1, z1], [x0, y1, z0], glass);
        const up = Math.max(1, Math.floor((top - y1) / 3.4)), fh = (top - y1) / up;
        for (let f = 0; f < up; f++) {
          const ya = y1 + f * fh, yb = ya + fh * 0.4, yc = ya + fh * 0.8, yd = ya + fh;
          quad([x0, ya, z0], [x1, ya, z1], [x1, yb, z1], [x0, yb, z0], wall);
          quad([x0, yb, z0], [x1, yb, z1], [x1, yc, z1], [x0, yc, z0], 0x5a6470);
          quad([x0, yc, z0], [x1, yc, z1], [x1, yd, z1], [x0, yd, z0], wall);
        }
      } else if (floors > 1 && glass != null) {
        // window bands: a strip of glass along every floor
        const fh = (h - 1) / floors;
        for (let f = 0; f < floors; f++) {
          const y0 = base + 1 + f * fh, y1 = y0 + fh * 0.38, y2 = y0 + fh;
          quad([x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0], wall);
          quad([x0, y1, z0], [x1, y1, z1], [x1, y2, z1], [x0, y2, z0], glass);
        }
        quad([x0, base, z0], [x1, base, z1], [x1, base + 1, z1], [x0, base + 1, z0], wall);
        if (K.trim) quad([x0, top - 0.6, z0], [x1, top - 0.6, z1], [x1, top, z1], [x0, top, z0], K.trim);
      } else {
        quad([x0, base, z0], [x1, base, z1], [x1, top, z1], [x0, top, z0], wall);
      }
    }
    if (hip) {
      // a hip roof: every eave up to a ridge point over the middle
      const ry = top + clamp(Math.sqrt(Math.abs(area(pts))) * 0.28, 1.6, 3.2);
      const roof = pick(K.roofs, hash(r * 997));
      for (let i = 0; i < ring.length; i++) {
        const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % ring.length];
        triUp([x0, top, z0], [x1, top, z1], [cx, ry, cz], roof);
      }
    } else {
      const roof = kind === 4 ? 0x7a7670 : pick(roofFlat, hash(r * 131));
      const flat = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), []);
      for (const [a, b2, c2] of flat) triUp([ring[a][0], top, ring[a][1]], [ring[b2][0], top, ring[b2][1]], [ring[c2][0], top, ring[c2][1]], roof);
    }
    n++;
  }

  // ---- side streets, parks and pitches on the ground -----------------------------------
  const flat = [], flatCol = [];
  const ftri = (a0, b0, c0, color) => { const [a, b2, c2] = up(a0, b0, c0); flat.push(...a, ...b2, ...c2); c.set(color); for (let k = 0; k < 3; k++) flatCol.push(c.r, c.g, c.b); };
  for (const rec of map.AREAS) {
    const kind = rec[0];
    const pts = [];
    for (let i = 1; i < rec.length; i += 2) pts.push([rec[i] * H, rec[i + 1] * H]);
    if (pts.length < 3) continue;
    const ring = ccw(pts) ? pts.slice().reverse() : pts;
    const y = (x, z) => heightAt(x, z) + (kind === 1 || kind === 6 ? 0.05 : 0.09);
    const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), []);
    for (const [a, b2, c2] of tris) {
      const P = [ring[a], ring[c2], ring[b2]];
      ftri([P[0][0], y(...P[0]), P[0][1]], [P[1][0], y(...P[1]), P[1][1]], [P[2][0], y(...P[2]), P[2][1]], AREA_COLORS[kind] ?? 0x78b050);
    }
    if (kind === 2) { track400(ring, y, ftri); lines(ring, y, ftri); } // the track and yard lines
    if (kind !== 1 && kind !== 6) fillPoly(pts, 0); // pitches stay open; parks and school lawns keep their trees
  }
  for (const rec of map.STREETS) {
    const w = rec[0] * H;
    const pts = [];
    for (let i = 1; i < rec.length; i += 2) pts.push([rec[i] * H, rec[i + 1] * H]);
    // walk it in short steps so the ribbon hugs the ground; stop under the race road
    const steps = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
      const L = Math.hypot(x1 - x0, z1 - z0), k = Math.max(1, Math.ceil(L / 8));
      for (let s = 0; s < k; s++) steps.push([x0 + ((x1 - x0) * s) / k, z0 + ((z1 - z0) * s) / k]);
    }
    steps.push(pts[pts.length - 1]);
    for (let i = 0; i + 1 < steps.length; i++) {
      const [x0, z0] = steps[i], [x1, z1] = steps[i + 1];
      if (!clear(x0, z0, w / 2 + 0.5) || !clear(x1, z1, w / 2 + 0.5)) continue;
      const L = Math.hypot(x1 - x0, z1 - z0) || 1, nx = -(z1 - z0) / L * (w / 2), nz = (x1 - x0) / L * (w / 2);
      const y0 = heightAt(x0, z0) + 0.07, y1 = heightAt(x1, z1) + 0.07;
      ftri([x0 - nx, y0, z0 - nz], [x1 - nx, y1, z1 - nz], [x1 + nx, y1, z1 + nz], 0x505358);
      ftri([x0 - nx, y0, z0 - nz], [x1 + nx, y1, z1 + nz], [x0 + nx, y0, z0 + nz], 0x505358);
      // a double yellow line down the middle of the big roads
      if (w >= 14) {
        for (const off of [-0.18, 0.18]) {
          const mx = (-(z1 - z0) / L) * off, mz = ((x1 - x0) / L) * off, lw = 0.07;
          const ex = (-(z1 - z0) / L) * lw, ez = ((x1 - x0) / L) * lw;
          ftri([x0 + mx - ex, y0 + 0.02, z0 + mz - ez], [x1 + mx - ex, y1 + 0.02, z1 + mz - ez], [x1 + mx + ex, y1 + 0.02, z1 + mz + ez], 0xe8c040);
          ftri([x0 + mx - ex, y0 + 0.02, z0 + mz - ez], [x1 + mx + ex, y1 + 0.02, z1 + mz + ez], [x0 + mx + ex, y0 + 0.02, z0 + mz + ez], 0xe8c040);
        }
      }
      // streets are taken too (props keep to the verges)
      for (let s = 0; s <= 1; s += 0.25) mark(x0 + (x1 - x0) * s, z0 + (z1 - z0) * s);
    }
  }

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const mesh = (p, cl, name, shadows) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    m.castShadow = shadows;
    m.receiveShadow = true;
    group.add(m);
  };
  mesh(pos, col, 'buildings', true);
  mesh(flat, flatCol, 'ground-detail', false);

  // ---- signs ----------------------------------------------------------------------------
  for (const s of map.SIGNS || []) streetSign(group, track, index, heightAt, s);
  if (map.SCHOOL) schoolSign(group, track, index, heightAt, map.SCHOOL);

  return {
    buildings: n,
    blocked: (x, z) => { const i = Math.floor((x - ox) / CELL), j = Math.floor((z - oz) / CELL); return i >= 0 && j >= 0 && i < gw && j < gh && occ[j * gw + i] === 1; },
  };
}

// white yard lines across a football field (its long axis from the outline)
function lines(ring, y, ftri) {
  // the field's long side: the longest edge
  let best = 0, bi = 0;
  ring.forEach(([x0, z0], i) => { const [x1, z1] = ring[(i + 1) % ring.length]; const L = Math.hypot(x1 - x0, z1 - z0); if (L > best) { best = L; bi = i; } });
  const [ax, az] = ring[bi], [bx, bz] = ring[(bi + 1) % ring.length];
  const ux = (bx - ax) / best, uz = (bz - az) / best; // along the field
  let wmax = 0; // the field's width: farthest point from that edge
  for (const [x, z] of ring) wmax = Math.max(wmax, Math.abs((x - ax) * -uz + (z - az) * ux));
  const side = ring.reduce((a, [x, z]) => a + ((x - ax) * -uz + (z - az) * ux), 0) > 0 ? 1 : -1;
  const vx = -uz * side, vz = ux * side;
  for (let k = 1; k < 10; k++) {
    const t = (best * k) / 10;
    const px = ax + ux * t, pz = az + uz * t, qx = px + vx * wmax, qz = pz + vz * wmax, lw = 0.12;
    const yy = (x, z) => y(x, z) + 0.03;
    ftri([px - ux * lw, yy(px, pz), pz - uz * lw], [qx - ux * lw, yy(qx, qz), qz - uz * lw], [qx + ux * lw, yy(qx, qz), qz + uz * lw], 0xf4f4f0);
    ftri([px - ux * lw, yy(px, pz), pz - uz * lw], [qx + ux * lw, yy(qx, qz), qz + uz * lw], [px + ux * lw, yy(px, pz), pz + uz * lw], 0xf4f4f0);
  }
}

// a red running track round a football field: a band just outside its edge
function track400(ring, y, ftri) {
  const n = ring.length;
  let cx = 0, cz = 0;
  for (const [x, z] of ring) { cx += x / n; cz += z / n; }
  for (let i = 0; i < n; i++) {
    const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % n];
    const out = (x, z, d) => { const dx = x - cx, dz = z - cz, L = Math.hypot(dx, dz) || 1; return [x + (dx / L) * d, z + (dz / L) * d]; };
    const [a0x, a0z] = out(x0, z0, 1.5), [a1x, a1z] = out(x1, z1, 1.5), [b0x, b0z] = out(x0, z0, 9), [b1x, b1z] = out(x1, z1, 9);
    const yy = (x, z) => y(x, z) - 0.02;
    ftri([a0x, yy(a0x, a0z), a0z], [a1x, yy(a1x, a1z), a1z], [b1x, yy(b1x, b1z), b1z], 0xb04a38);
    ftri([a0x, yy(a0x, a0z), a0z], [b1x, yy(b1x, b1z), b1z], [b0x, yy(b0x, b0z), b0z], 0xb04a38);
  }
}

// a text board from a canvas
function board(lines2, w, h, { bg = '#1f6e3a', fg = '#ffffff', border = '#ffffff', font = 'bold', sizes = [] } = {}) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = Math.round((512 * h) / w);
  const g = cv.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, cv.width, cv.height);
  g.strokeStyle = border; g.lineWidth = cv.height * 0.05; g.strokeRect(g.lineWidth, g.lineWidth, cv.width - 2 * g.lineWidth, cv.height - 2 * g.lineWidth);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines2.forEach((t, i) => {
    const size = (sizes[i] ?? 0.5) * cv.height / Math.max(1, lines2.length * 0.8);
    g.font = `${font} ${size}px Arial, sans-serif`;
    const y = ((i + 0.5) / lines2.length) * cv.height;
    g.fillText(t, cv.width / 2, y, cv.width * 0.9);
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return new THREE.MeshBasicMaterial({ map: tex });
}

// a spot beside the road at a point: out to the given side until clear of it
function besideRoad(index, x, z, dirx, dirz, want) {
  for (let k = 0; k < 30; k++) {
    const px = x + dirx * (want + k), pz = z + dirz * (want + k);
    const n = index.nearest(px, pz, 12);
    if (!n || n.d > 2.5) return [px, pz];
  }
  return [x + dirx * (want + 30), z + dirz * (want + 30)];
}

// green US street name blades on a post
function streetSign(group, track, index, heightAt, s) {
  const [x, z] = besideRoad(index, s.x, s.z, Math.cos(s.yaw), -Math.sin(s.yaw), 6);
  const y = heightAt(x, z);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 6), new THREE.MeshLambertMaterial({ color: 0x5a5e66 }));
  post.position.set(x, y + 1.6, z);
  group.add(post);
  const blade = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.5), board([s.text], 2.6, 0.5, { sizes: [1.1] }));
  blade.position.set(x, y + 3.1, z);
  blade.rotation.y = s.yaw; // faces the driver coming along the street
  blade.material.side = THREE.DoubleSide;
  group.add(blade);
}

// the school's sign by the finish: brick base, blue board, gold letters
function schoolSign(group, track, index, heightAt, school) {
  const f = track.finish;
  const toward = (school.x - f.p.x) * f.l.x + (school.z - f.p.z) * f.l.z > 0 ? 1 : -1;
  const lx = f.l.x * toward, lz = f.l.z * toward;
  const bx = f.p.x - f.t.x * 30, bz = f.p.z - f.t.z * 30;
  const [x, z] = besideRoad(index, bx, bz, lx, lz, f.hw + 5);
  const y = heightAt(x, z);
  const yaw = Math.atan2(-lx, -lz); // face the road
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = yaw;
  const brick = new THREE.MeshLambertMaterial({ color: 0xa84a3a });
  const base = new THREE.Mesh(new THREE.BoxGeometry(7.4, 1.2, 0.9), brick);
  base.position.y = 0.6;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(7.4, 3.2, 0.6), brick);
  frame.position.y = 2.8;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 2.7), board(['BETHESDA-CHEVY CHASE', 'HIGH SCHOOL', 'HOME OF THE BARONS'], 6.8, 2.7, { bg: '#123a8a', fg: '#f2b82c', border: '#f2b82c', sizes: [0.62, 0.62, 0.42] }));
  face.position.set(0, 2.8, 0.31);
  const back = face.clone();
  back.rotation.y = Math.PI;
  back.position.z = -0.31;
  for (const m of [base, frame]) { m.castShadow = true; m.receiveShadow = true; }
  g.add(base, frame, face, back);
  group.add(g);
}

function inPoly(pts, x, z) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function nearPoly(pts, x, z, r) {
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, az] = pts[j], dx = pts[i][0] - ax, dz = pts[i][1] - az, L2 = dx * dx + dz * dz || 1;
    const u = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
    if (Math.hypot(ax + dx * u - x, az + dz * u - z) < r) return true;
  }
  return false;
}
function area(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % pts.length]; a += x0 * z1 - x1 * z0; } return a / 2; }
// winding as seen from above (+y): walls must face outward
const ccw = (pts) => area(pts) > 0;
function hash(n) { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); }
