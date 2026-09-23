// Static collision world: a triangle soup bucketed into an XZ grid, plus an
// optional infinite ground plane. Wheel rays and chassis spheres query it every
// physics substep, so the inner loops avoid allocation entirely.

export class CollisionWorld {
  constructor() {
    this._raw = [];
    this._mats = [];
    this.count = 0;
    this.ground = null; // { y, mat } infinite plane backstop, or null for a void
  }

  addTri(ax, ay, az, bx, by, bz, cx, cy, cz, mat) {
    this._raw.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    this._mats.push(mat);
  }

  // positions: flat xyz array, 9 per triangle (non-indexed); mats: number or per-tri array
  addSoup(positions, mat) {
    const n = positions.length / 9;
    for (let i = 0; i < n; i++) {
      const o = i * 9;
      this.addTri(positions[o], positions[o + 1], positions[o + 2], positions[o + 3], positions[o + 4],
        positions[o + 5], positions[o + 6], positions[o + 7], positions[o + 8], typeof mat === 'number' ? mat : mat[i]);
    }
  }

  build(cellSize = 8) {
    const n = this._mats.length;
    this.count = n;
    const v = (this.v = new Float64Array(this._raw));
    this.mat = new Uint8Array(this._mats);
    const nrm = (this.nrm = new Float64Array(n * 3));
    const box = (this.box = new Float64Array(n * 6));
    this._raw = null;
    this._mats = null;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const o = i * 9;
      const e1x = v[o + 3] - v[o], e1y = v[o + 4] - v[o + 1], e1z = v[o + 5] - v[o + 2];
      const e2x = v[o + 6] - v[o], e2y = v[o + 7] - v[o + 1], e2z = v[o + 8] - v[o + 2];
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const l = Math.hypot(nx, ny, nz) || 1;
      nrm[i * 3] = nx / l; nrm[i * 3 + 1] = ny / l; nrm[i * 3 + 2] = nz / l;
      const b = i * 6;
      box[b] = Math.min(v[o], v[o + 3], v[o + 6]); box[b + 1] = Math.max(v[o], v[o + 3], v[o + 6]);
      box[b + 2] = Math.min(v[o + 1], v[o + 4], v[o + 7]); box[b + 3] = Math.max(v[o + 1], v[o + 4], v[o + 7]);
      box[b + 4] = Math.min(v[o + 2], v[o + 5], v[o + 8]); box[b + 5] = Math.max(v[o + 2], v[o + 5], v[o + 8]);
      minX = Math.min(minX, box[b]); maxX = Math.max(maxX, box[b + 1]);
      minZ = Math.min(minZ, box[b + 4]); maxZ = Math.max(maxZ, box[b + 5]);
    }
    if (n === 0) { minX = minZ = -1; maxX = maxZ = 1; }
    this.cs = cellSize;
    this.ox = minX - cellSize;
    this.oz = minZ - cellSize;
    this.nx = Math.max(1, Math.ceil((maxX - this.ox) / cellSize) + 2);
    this.nz = Math.max(1, Math.ceil((maxZ - this.oz) / cellSize) + 2);
    const cells = this.nx * this.nz;
    const counts = new Int32Array(cells + 1);
    const forEachCell = (i, fn) => {
      const b = i * 6;
      const x0 = this._cx(box[b]), x1 = this._cx(box[b + 1]);
      const z0 = this._cz(box[b + 4]), z1 = this._cz(box[b + 5]);
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) fn(z * this.nx + x);
    };
    for (let i = 0; i < n; i++) forEachCell(i, (c) => counts[c + 1]++);
    for (let c = 0; c < cells; c++) counts[c + 1] += counts[c];
    const start = (this.cellStart = counts);
    const fill = new Int32Array(cells);
    const items = (this.cellItems = new Int32Array(start[cells]));
    for (let i = 0; i < n; i++) forEachCell(i, (c) => { items[start[c] + fill[c]++] = i; });
    this.stampArr = new Uint32Array(n);
    this.stamp = 0;
    return this;
  }

  _cx(x) { return Math.max(0, Math.min(this.nx - 1, Math.floor((x - this.ox) / this.cs))); }
  _cz(z) { return Math.max(0, Math.min(this.nz - 1, Math.floor((z - this.oz) / this.cs))); }

  _nextStamp() {
    this.stamp = (this.stamp + 1) >>> 0;
    if (this.stamp === 0) { this.stampArr.fill(0); this.stamp = 1; }
    return this.stamp;
  }

  // Ray from o along unit d up to maxT. Fills hit {t, px,py,pz, nx,ny,nz, mat, tri}; normal faces the ray.
  raycast(ox, oy, oz, dx, dy, dz, maxT, hit) {
    let best = maxT, bi = -1;
    if (this.count) {
      const ex = ox + dx * maxT, ey = oy + dy * maxT, ez = oz + dz * maxT;
      const sx0 = Math.min(ox, ex), sx1 = Math.max(ox, ex);
      const sy0 = Math.min(oy, ey), sy1 = Math.max(oy, ey);
      const sz0 = Math.min(oz, ez), sz1 = Math.max(oz, ez);
      const x0 = this._cx(sx0), x1 = this._cx(sx1), z0 = this._cz(sz0), z1 = this._cz(sz1);
      const st = this._nextStamp();
      const v = this.v, box = this.box, items = this.cellItems, start = this.cellStart, marks = this.stampArr;
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          const c = cz * this.nx + cx;
          for (let k = start[c], ke = start[c + 1]; k < ke; k++) {
            const i = items[k];
            if (marks[i] === st) continue;
            marks[i] = st;
            const b = i * 6;
            if (box[b] > sx1 || box[b + 1] < sx0 || box[b + 2] > sy1 || box[b + 3] < sy0 || box[b + 4] > sz1 || box[b + 5] < sz0) continue;
            // Moller-Trumbore, double sided
            const o = i * 9;
            const ax = v[o], ay = v[o + 1], az = v[o + 2];
            const e1x = v[o + 3] - ax, e1y = v[o + 4] - ay, e1z = v[o + 5] - az;
            const e2x = v[o + 6] - ax, e2y = v[o + 7] - ay, e2z = v[o + 8] - az;
            const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
            const det = e1x * px + e1y * py + e1z * pz;
            if (det > -1e-12 && det < 1e-12) continue;
            const inv = 1 / det;
            const tx = ox - ax, ty = oy - ay, tz = oz - az;
            const u = (tx * px + ty * py + tz * pz) * inv;
            if (u < -1e-9 || u > 1 + 1e-9) continue;
            const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
            const w = (dx * qx + dy * qy + dz * qz) * inv;
            if (w < -1e-9 || u + w > 1 + 1e-9) continue;
            const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
            if (t >= 0 && t < best) { best = t; bi = i; }
          }
        }
      }
    }
    let groundHit = false;
    if (this.ground && dy < -1e-9) {
      const t = (this.ground.y - oy) / dy;
      if (t >= 0 && t < best) { best = t; groundHit = true; }
    }
    if (bi < 0 && !groundHit) return false;
    hit.t = best;
    hit.px = ox + dx * best; hit.py = oy + dy * best; hit.pz = oz + dz * best;
    if (groundHit) {
      hit.nx = 0; hit.ny = 1; hit.nz = 0; hit.mat = this.ground.mat; hit.tri = -1;
    } else {
      let nx = this.nrm[bi * 3], ny = this.nrm[bi * 3 + 1], nz = this.nrm[bi * 3 + 2];
      if (nx * dx + ny * dy + nz * dz > 0) { nx = -nx; ny = -ny; nz = -nz; }
      hit.nx = nx; hit.ny = ny; hit.nz = nz; hit.mat = this.mat[bi]; hit.tri = bi;
    }
    return true;
  }

  // Sphere overlap. Writes up to max contacts {nx,ny,nz,depth,px,py,pz,mat} into out; returns count.
  sphere(cx, cy, cz, r, out, max = 8) {
    let count = 0;
    if (this.count) {
      const x0 = this._cx(cx - r), x1 = this._cx(cx + r), z0 = this._cz(cz - r), z1 = this._cz(cz + r);
      const st = this._nextStamp();
      const v = this.v, box = this.box, items = this.cellItems, start = this.cellStart, marks = this.stampArr;
      const r2 = r * r;
      for (let gz = z0; gz <= z1 && count < max; gz++) {
        for (let gx = x0; gx <= x1 && count < max; gx++) {
          const c = gz * this.nx + gx;
          for (let k = start[c], ke = start[c + 1]; k < ke && count < max; k++) {
            const i = items[k];
            if (marks[i] === st) continue;
            marks[i] = st;
            const b = i * 6;
            if (box[b] > cx + r || box[b + 1] < cx - r || box[b + 2] > cy + r || box[b + 3] < cy - r || box[b + 4] > cz + r || box[b + 5] < cz - r) continue;
            closestOnTri(v, i * 9, cx, cy, cz, CP);
            const ddx = cx - CP[0], ddy = cy - CP[1], ddz = cz - CP[2];
            const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
            if (d2 >= r2) continue;
            const d = Math.sqrt(d2);
            const c2 = out[count] || (out[count] = {});
            if (d > 1e-6) { c2.nx = ddx / d; c2.ny = ddy / d; c2.nz = ddz / d; }
            else {
              let nx = this.nrm[i * 3], ny = this.nrm[i * 3 + 1], nz = this.nrm[i * 3 + 2];
              c2.nx = nx; c2.ny = ny; c2.nz = nz;
            }
            c2.depth = r - d;
            c2.px = CP[0]; c2.py = CP[1]; c2.pz = CP[2];
            c2.mat = this.mat[i];
            count++;
          }
        }
      }
    }
    if (this.ground && count < max && cy - r < this.ground.y) {
      const c2 = out[count] || (out[count] = {});
      c2.nx = 0; c2.ny = 1; c2.nz = 0; c2.depth = this.ground.y - (cy - r);
      c2.px = cx; c2.py = this.ground.y; c2.pz = cz; c2.mat = this.ground.mat;
      count++;
    }
    return count;
  }
}

const CP = new Float64Array(3);

// Ericson, Real-Time Collision Detection 5.1.5
function closestOnTri(v, o, px, py, pz, out) {
  const ax = v[o], ay = v[o + 1], az = v[o + 2];
  const bx = v[o + 3], by = v[o + 4], bz = v[o + 5];
  const cx = v[o + 6], cy = v[o + 7], cz = v[o + 8];
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out[0] = ax; out[1] = ay; out[2] = az; return; }
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out[0] = bx; out[1] = by; out[2] = bz; return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3);
    out[0] = ax + abx * t; out[1] = ay + aby * t; out[2] = az + abz * t; return;
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out[0] = cx; out[1] = cy; out[2] = cz; return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6);
    out[0] = ax + acx * t; out[1] = ay + acy * t; out[2] = az + acz * t; return;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const t = (d4 - d3) / (d4 - d3 + (d5 - d6));
    out[0] = bx + (cx - bx) * t; out[1] = by + (cy - by) * t; out[2] = bz + (cz - bz) * t; return;
  }
  const den = 1 / (va + vb + vc);
  const vv = vb * den, ww = vc * den;
  out[0] = ax + abx * vv + acx * ww; out[1] = ay + aby * vv + acy * ww; out[2] = az + abz * vv + acz * ww;
}
