// Terrain height field shared by the renderer and the collision world, so what
// you see is exactly what you drive on. Flat where roads run, rolling hills
// further out, mountains at the rim; islands in a sea for wet themes.
import { makeNoise2D, mulberry32, hashString, smoothstep } from '../util/math.js';
import { RoadIndex } from './roadindex.js';

export function makeTerrain(track, theme) {
  const seed = hashString(track.def.id + ':terrain');
  const noise = makeNoise2D(seed);
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  const index = new RoadIndex(track, 24);
  const b = track.bounds;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const radius = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2;
  const wet = theme.ground === 'water' || theme.ground === 'lava';
  const hillAmp = theme.hills ?? 22;
  const mtn = theme.mountainAmp ?? 110;
  const distCenter = (x, z) => Math.max(0, Math.hypot(x - cx, z - cz) - radius);
  const nearBox = (x, z, m) => x > b.minX - m && x < b.maxX + m && z > b.minZ - m && z < b.maxZ + m;

  const heightAt = (x, z) => {
    const near = nearBox(x, z, 170) ? index.nearest(x, z, 160) : null;
    const d = near ? near.d : 160;
    const n = noise.fbm(x / 240, z / 240, 4);
    const n2 = noise.fbm(x / 70 + 50, z / 70, 3);
    const rim = smoothstep(380, 850, distCenter(x, z));
    if (wet) {
      const isl = smoothstep(0.05, 0.35, n) * 24 + n2 * 3;
      return -7 + smoothstep(22, 80, d) * (isl + 2) + rim * 90 * (0.6 + n);
    }
    let h = smoothstep(16, 130, d) * (hillAmp * (0.35 + n * 0.9) + n2 * 4);
    h += rim * mtn * (0.55 + n);
    return Math.max(0, h);
  };

  let grid = null;
  if (theme.ground !== 'void') {
    const extent = 1050, cell = 22;
    const x0 = b.minX - extent, z0 = b.minZ - extent;
    const nx = Math.ceil((b.maxX + extent - x0) / cell), nz = Math.ceil((b.maxZ + extent - z0) / cell);
    const N = (nx + 1) * (nz + 1);
    const X = new Float32Array(N), Z = new Float32Array(N), H = new Float32Array(N);
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const k = j * (nx + 1) + i;
      const edge = i === 0 || j === 0 || i === nx || j === nz;
      X[k] = x0 + i * cell + (edge ? 0 : (rnd() - 0.5) * cell * 0.55);
      Z[k] = z0 + j * cell + (edge ? 0 : (rnd() - 0.5) * cell * 0.55);
      H[k] = heightAt(X[k], Z[k]);
    }
    grid = { x0, z0, nx, nz, cell, X, Z, H };
  }

  // triangles as index triples, alternating diagonals
  const forEachTri = (fn) => {
    if (!grid) return;
    const { nx, nz } = grid;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, bq = a + 1, c = a + nx + 1, d = c + 1;
      if ((i + j) % 2) { fn(a, c, bq, i, j); fn(bq, c, d, i, j); } else { fn(a, c, d, i, j); fn(a, d, bq, i, j); }
    }
  };

  return { heightAt, grid, forEachTri, index, wet };
}
