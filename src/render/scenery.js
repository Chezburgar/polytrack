// Terrain mesh, water/lava, instanced props, city blocks, street lamps,
// asteroids and planets around a track. The terrain comes from the shared
// height field so it matches collision exactly.
import * as THREE from 'three';
import { mulberry32, hashString, clamp } from '../util/math.js';
import { makeProp, makeGrandstand, GeoBuilder } from './props.js';
import { frameAt } from '../track/geometry.js';
import { makeTerrain } from '../track/terrain.js';

const PROP_SPEC = {
  oak: { n: 900, min: 9, scale: [0.8, 1.35], tall: 7 },
  autumn: { n: 950, min: 9, scale: [0.8, 1.3], tall: 7 },
  redtree: { n: 500, min: 9, scale: [0.8, 1.3], tall: 7 },
  pine: { n: 1000, min: 9, scale: [0.85, 1.5], tall: 9 },
  snowpine: { n: 1100, min: 9, scale: [0.85, 1.6], tall: 9 },
  bush: { n: 700, min: 5, scale: [0.7, 1.4], tall: 2 },
  rock: { n: 420, min: 5, scale: [0.6, 1.8], tall: 2 },
  boulder: { n: 120, min: 14, scale: [1, 2.4], tall: 6 },
  tuft: { n: 1400, min: 3.5, scale: [0.8, 1.4], tall: 1 },
  flower: { n: 700, min: 4, scale: [0.9, 1.3], tall: 1 },
  palm: { n: 420, min: 8, scale: [0.9, 1.3], tall: 9 },
  cactus: { n: 420, min: 7, scale: [0.8, 1.4], tall: 5 },
  deadtree: { n: 380, min: 7, scale: [0.8, 1.5], tall: 6 },
  crystal: { n: 320, min: 7, scale: [0.8, 2.2], tall: 6 },
  mesa: { n: 26, min: 90, scale: [28, 60], tall: 30, far: true },
  iceberg: { n: 60, min: 25, scale: [2, 5], tall: 6 },
};

export function buildScenery(track, theme, { decor = 1, terrain = null } = {}) {
  const group = new THREE.Group();
  group.name = 'scenery';
  const seed = hashString(track.def.id + ':scenery');
  const rnd = mulberry32(seed);
  terrain = terrain || makeTerrain(track, theme);
  const { heightAt, index } = terrain;
  const b = track.bounds;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const ground = theme.ground;
  const wet = terrain.wet;
  const updates = [];
  const propMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });

  // ---- terrain mesh -------------------------------------------------------------
  if (terrain.grid) {
    const { X, Z, H } = terrain.grid;
    const pal = (theme.groundColors || [0x6fae45]).map((c) => new THREE.Color(c));
    const high = new THREE.Color(theme.hillColor ?? theme.groundColors?.[theme.groundColors.length - 1] ?? 0x88aa66);
    const rockC = new THREE.Color(theme.rockColor ?? 0x8b8f96);
    const peakC = new THREE.Color(theme.peakColor ?? 0xf4f7fa);
    const sandC = new THREE.Color(theme.shoreColor ?? 0xe0cb8f);
    const seabed = new THREE.Color(theme.seabedColor ?? theme.shoreColor ?? 0xc8b27a).multiplyScalar(0.7);
    const pos = [], col = [];
    const c = new THREE.Color();
    terrain.forEachTri((a, bq, cc) => {
      const ax = X[a], ay = H[a], az = Z[a], bx = X[bq], by = H[bq], bz = Z[bq], qx = X[cc], qy = H[cc], qz = Z[cc];
      pos.push(ax, ay, az, bx, by, bz, qx, qy, qz);
      const hy = (ay + by + qy) / 3;
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az, e2x = qx - ax, e2y = qy - ay, e2z = qz - az;
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const flat = Math.abs(ny) / (Math.hypot(nx, ny, nz) || 1);
      c.copy(pal[Math.floor(rnd() * pal.length)]);
      if (wet) {
        if (hy < -2.6) c.copy(seabed);
        else if (hy < 1.2) c.copy(sandC);
      }
      c.lerp(high, clamp(hy / 70, 0, 0.55));
      if (flat < 0.82) c.lerp(rockC, clamp((0.82 - flat) * 3.2, 0, 1));
      if (theme.snowcaps && hy > 60) c.lerp(peakC, 0.85);
      c.multiplyScalar(0.94 + rnd() * 0.12);
      for (let q = 0; q < 3; q++) col.push(c.r, c.g, c.b);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    group.add(mesh);
  }

  // ---- water / lava sheet ----------------------------------------------------------
  if (wet) {
    const lava = ground === 'lava';
    const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + 2600;
    const wg = new THREE.PlaneGeometry(size, size, 80, 80).toNonIndexed();
    wg.rotateX(-Math.PI / 2);
    const base = wg.attributes.position.array.slice();
    const wm = new THREE.MeshLambertMaterial({
      color: lava ? 0xff6a1a : theme.waterColor ?? 0x2aa7c9, flatShading: true, transparent: !lava, opacity: lava ? 1 : 0.82,
      emissive: lava ? 0xff3a00 : theme.waterGlow ?? 0x0a3a4a, emissiveIntensity: lava ? 1.25 : 0.3,
    });
    const water = new THREE.Mesh(wg, wm);
    water.position.set(cx, -2.2, cz);
    water.receiveShadow = !lava;
    group.add(water);
    const arr = wg.attributes.position.array;
    const amp = lava ? 0.22 : 0.3;
    let acc = 0;
    updates.push((t, dt = 1 / 60) => {
      acc += dt;
      if (acc < 1 / 30) return; // waves at 30 Hz is plenty
      acc = 0;
      for (let i = 0; i < arr.length; i += 3) {
        const x = base[i], z = base[i + 2];
        arr[i + 1] = (Math.sin(x * 0.045 + t * (lava ? 0.5 : 1.1)) + Math.cos(z * 0.05 + t * (lava ? 0.4 : 0.8))) * amp;
      }
      wg.attributes.position.needsUpdate = true;
      wg.computeVertexNormals();
    });
  }

  // ---- props --------------------------------------------------------------------------
  const TILE = 260;
  const tiles = new Map();
  const place = (kind, x, y, z, s, yaw, tint, sy = s) => {
    const key = `${kind}|${Math.floor(x / TILE)}|${Math.floor(z / TILE)}`;
    let t = tiles.get(key);
    if (!t) tiles.set(key, (t = { kind, items: [] }));
    t.items.push([x, y, z, s, yaw, tint, sy]);
  };
  const area = (b.maxX - b.minX + 500) * (b.maxZ - b.minZ + 500);
  const areaK = clamp(area / (900 * 900), 0.5, 2.2);
  const randomSpot = (sp) => {
    if (rnd() < 0.75 && !sp.far) {
      const sm = track.samples[Math.floor(rnd() * track.samples.length)];
      const side = rnd() < 0.5 ? -1 : 1;
      const off = sm.hw + sp.min + Math.pow(rnd(), 1.6) * 220;
      return [sm.p.x + sm.l.x * side * off + (rnd() - 0.5) * 20, sm.p.z + sm.l.z * side * off + (rnd() - 0.5) * 20];
    }
    return [b.minX - 250 + rnd() * (b.maxX - b.minX + 500), b.minZ - 250 + rnd() * (b.maxZ - b.minZ + 500)];
  };
  if (ground !== 'void') {
    for (const kind of theme.decor || []) {
      const sp = PROP_SPEC[kind];
      if (!sp) continue;
      const count = Math.round(sp.n * decor * (theme.density ?? 1) * areaK);
      let placed = 0;
      for (let tries = 0; tries < count * 4 && placed < count; tries++) {
        const [x, z] = randomSpot(sp);
        const s = sp.scale[0] + rnd() * (sp.scale[1] - sp.scale[0]);
        const near = index.nearest(x, z, sp.min + 60);
        if (near && near.d < sp.min + (sp.far ? s : 0)) continue;
        if (index.roadAbove(x, z, 3 + s) !== null) continue;
        const y = heightAt(x, z);
        if (wet && y < 0.4 && kind !== 'iceberg') continue;
        if (kind === 'iceberg' && y > -3) continue;
        place(kind, x, kind === 'iceberg' ? -2.2 : y - 0.1, z, s, rnd() * Math.PI * 2, 0.85 + rnd() * 0.3, kind === 'mesa' ? s * (0.35 + rnd() * 0.45) : s);
        placed++;
      }
    }
  } else {
    // floating asteroids around the course
    const n = Math.round(260 * decor);
    for (let i = 0; i < n; i++) {
      const [x, z] = randomSpot({ min: 16 });
      const near = index.nearest(x, z, 40);
      if (near && near.d < 12) continue;
      const y = b.minY + (rnd() - 0.6) * 90;
      const s = 2 + Math.pow(rnd(), 2) * 16;
      place(rnd() < 0.8 ? 'rock' : 'crystal', x, y, z, s, rnd() * Math.PI * 2, 0.8 + rnd() * 0.4, s * (0.6 + rnd() * 0.6));
    }
  }
  const protos = {};
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pv = new THREE.Vector3();
  const tintC = new THREE.Color();
  for (const t of tiles.values()) {
    const proto = protos[t.kind] || (protos[t.kind] = makeProp(t.kind, mulberry32(seed ^ hashString(t.kind)), theme.propPalette || {}));
    const im = new THREE.InstancedMesh(proto, propMat, t.items.length);
    const floating = ground === 'void';
    t.items.forEach(([x, y, z, s, yaw, tint, sy], i) => {
      e.set(floating ? rnd() * 6 : 0, yaw, floating ? rnd() * 6 : 0);
      q.setFromEuler(e);
      m4.compose(pv.set(x, y, z), q, sc.set(s, sy, s));
      im.setMatrixAt(i, m4);
      im.setColorAt(i, tintC.setScalar(tint));
    });
    const spec = PROP_SPEC[t.kind] || { tall: 3 };
    im.castShadow = spec.tall > 1.5 && !floating;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  }

  // ---- city blocks (night themes) -------------------------------------------------
  if (theme.city) buildCity(group, track, theme, index, heightAt, rnd, decor, propMat, glowMat);

  // ---- street lamps along the course --------------------------------------------------
  if (theme.lamps) {
    const lamp = new GeoBuilder();
    const glow = new GeoBuilder();
    let lastS = -1e9, side = 1;
    const col = new THREE.Color(theme.lampColor ?? 0xffd9a0).multiplyScalar(2.4);
    for (const sm of track.samples) {
      if (!sm.road || sm.kind === 'LOOP' || sm.s - lastS < 34) continue;
      lastS = sm.s;
      side = -side;
      if (side < 0 ? sm.wallR : sm.wallL) continue;
      const out = sm.l.clone().setY(0).normalize().multiplyScalar(side);
      const base = sm.p.clone().addScaledVector(out, sm.hw + 1.6);
      const groundY = sm.p.y - 0.8;
      const h = 7.5;
      const yaw = Math.atan2(-out.x, -out.z);
      lamp.add(new THREE.CylinderGeometry(0.1, 0.14, h + (sm.p.y - groundY), 6), 0x2c3140, { pos: [base.x, (groundY + sm.p.y + h) / 2, base.z] });
      const arm = base.clone().addScaledVector(out, -1.1);
      lamp.add(new THREE.BoxGeometry(0.12, 0.12, 2.3), 0x2c3140, { pos: [(base.x + arm.x) / 2, sm.p.y + h, (base.z + arm.z) / 2], rot: [0, yaw, 0] });
      glow.add(new THREE.BoxGeometry(0.5, 0.12, 0.9), col.getHex(), { pos: [arm.x, sm.p.y + h - 0.1, arm.z], rot: [0, yaw, 0] });
    }
    if (lamp.pos.length) {
      const lm = new THREE.Mesh(lamp.build(), propMat);
      lm.castShadow = true;
      group.add(lm);
      const gg = glow.build();
      const arr = gg.attributes.color.array;
      for (let i = 0; i < arr.length; i += 3) { arr[i] = col.r; arr[i + 1] = col.g; arr[i + 2] = col.b; }
      group.add(new THREE.Mesh(gg, glowMat));
    }
  }

  // ---- planets (space) ------------------------------------------------------------------
  if (theme.planets) {
    for (const [i, p] of theme.planets.entries()) {
      const geo = new THREE.IcosahedronGeometry(p.r, 2).toNonIndexed();
      const colors = [];
      const pc = geo.attributes.position.array;
      const c1 = new THREE.Color(p.c1), c2 = new THREE.Color(p.c2);
      for (let k = 0; k < pc.length; k += 9) {
        const y = (pc[k + 1] + pc[k + 4] + pc[k + 7]) / 3 / p.r;
        const band = Math.sin(y * 9 + i) * 0.5 + 0.5;
        const cc = c1.clone().lerp(c2, band).multiplyScalar(0.9 + rnd() * 0.15);
        for (let v = 0; v < 3; v++) colors.push(cc.r, cc.g, cc.b);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: false }));
      m.position.set(...p.pos);
      m.userData.skyAttached = true;
      if (p.ring) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(p.r * 1.4, p.r * 2.1, 36, 1), new THREE.MeshBasicMaterial({ color: p.ring, side: THREE.DoubleSide, transparent: true, opacity: 0.55, fog: false }));
        ring.rotation.x = Math.PI / 2 - 0.35;
        m.add(ring);
      }
      group.userData.planets = group.userData.planets || [];
      group.userData.planets.push(m);
      group.add(m);
    }
  }

  // ---- grandstands along the start straight --------------------------------------------
  if (theme.grandstands !== false && ground !== 'void' && !wet) {
    const f = frameAt(track, track.start.s - 12);
    const side = f.wallL ? -1 : 1;
    const p = f.p.clone().addScaledVector(f.l, side * (f.hw + 9));
    if (index.roadAbove(p.x, p.z, 12) === null && f.p.y < 1.5) {
      const gm = new THREE.Mesh(makeGrandstand(rnd), propMat);
      gm.position.set(p.x, heightAt(p.x, p.z), p.z);
      const face = f.l.clone().multiplyScalar(-side);
      gm.rotation.y = Math.atan2(face.x, face.z);
      gm.castShadow = true;
      gm.receiveShadow = true;
      group.add(gm);
    }
  }

  group.userData.update = (t, dt, camPos) => {
    for (const u of updates) u(t, dt);
    // planets hang in the sky: keep them relative to the camera
    for (const p of group.userData.planets || []) {
      if (!p.userData.base) p.userData.base = p.position.clone();
      if (camPos) p.position.set(camPos.x + p.userData.base.x, p.userData.base.y, camPos.z + p.userData.base.z);
      p.rotation.y = t * 0.01;
    }
  };
  group.userData.heightAt = heightAt;
  return group;
}

// Night city: blocks of towers with lit windows around the course plus a
// distant skyline ring.
function buildCity(group, track, theme, index, heightAt, rnd, decor, propMat, glowMat) {
  const body = new GeoBuilder();
  const win = new GeoBuilder();
  const b = track.bounds;
  const winCols = (theme.windowColors || [0xffd9a0, 0x9fd8ff, 0xff9ff0]).map((c) => new THREE.Color(c));
  const bodyCols = theme.buildingColors || [0x1d2030, 0x22263a, 0x1a1c2a, 0x262a40];
  const n = Math.round(420 * decor * clamp(((b.maxX - b.minX + 400) * (b.maxZ - b.minZ + 400)) / (800 * 800), 0.6, 2));
  let placed = 0;
  for (let tries = 0; tries < n * 6 && placed < n; tries++) {
    const x = b.minX - 260 + rnd() * (b.maxX - b.minX + 520);
    const z = b.minZ - 260 + rnd() * (b.maxZ - b.minZ + 520);
    const w = 10 + rnd() * 16, d = 10 + rnd() * 16;
    const near = index.nearest(x, z, 80);
    if (near && near.d < Math.max(w, d) * 0.75 + 10) continue;
    if (index.roadAbove(x, z, Math.max(w, d)) !== null) continue;
    const hgt = 14 + Math.pow(rnd(), 1.6) * (near && near.d < 60 ? 45 : 110);
    const y0 = heightAt(x, z);
    const yaw = Math.round(rnd() * 4) * (Math.PI / 2) + (rnd() - 0.5) * 0.1;
    const bc = bodyCols[Math.floor(rnd() * bodyCols.length)];
    body.add(new THREE.BoxGeometry(w, hgt, d), bc, { pos: [x, y0 + hgt / 2, z], rot: [0, yaw, 0] });
    if (rnd() < 0.4) body.add(new THREE.BoxGeometry(w * 0.6, hgt * 0.18, d * 0.6), bc, { pos: [x, y0 + hgt * 1.09, z], rot: [0, yaw, 0] });
    // windows: rows of lit panes on each face
    const wc = winCols[Math.floor(rnd() * winCols.length)];
    const rows = Math.floor(hgt / 3.4);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    for (const [fx, fz, len, nx, nz] of [[0, d / 2 + 0.05, w, 0, 1], [0, -d / 2 - 0.05, w, 0, -1], [w / 2 + 0.05, 0, d, 1, 0], [-w / 2 - 0.05, 0, d, -1, 0]]) {
      const cols = Math.floor(len / 2.6);
      for (let r = 1; r < rows; r++) {
        for (let k = 0; k < cols; k++) {
          if (rnd() < 0.42) continue;
          const t = (k + 0.5) / cols - 0.5;
          const lx = fx + (nz !== 0 ? t * len : 0), lz = fz + (nx !== 0 ? t * len : 0);
          const wx = x + lx * cy + lz * sy, wz = z - lx * sy + lz * cy;
          const k2 = 0.55 + rnd() * 0.6;
          win.add(new THREE.PlaneGeometry(1.3, 1.6), new THREE.Color(wc).multiplyScalar(k2).getHex(), { pos: [wx, y0 + r * 3.4, wz], rot: [0, Math.atan2(nx * cy + nz * sy, -nx * sy + nz * cy), 0] });
        }
      }
    }
    placed++;
  }
  if (body.pos.length) {
    const bm = new THREE.Mesh(body.build(), propMat);
    bm.castShadow = true;
    bm.receiveShadow = true;
    group.add(bm);
  }
  if (win.pos.length) {
    const wg = win.build();
    const c = wg.attributes.color.array;
    for (let i = 0; i < c.length; i++) c[i] *= 2.0;
    group.add(new THREE.Mesh(wg, glowMat));
  }
}
