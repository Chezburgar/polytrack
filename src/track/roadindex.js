// 2D spatial index over road samples for "how far is this point from any road"
// queries (terrain shaping, scenery placement, minimap).
export class RoadIndex {
  constructor(track, cell = 24) {
    this.track = track;
    this.cell = cell;
    const b = track.bounds;
    this.ox = b.minX - cell * 2;
    this.oz = b.minZ - cell * 2;
    this.nx = Math.ceil((b.maxX - this.ox) / cell) + 3;
    this.nz = Math.ceil((b.maxZ - this.oz) / cell) + 3;
    this.cells = new Map();
    track.samples.forEach((s, i) => {
      if (!s.road) return;
      const k = this._key(Math.floor((s.p.x - this.ox) / cell), Math.floor((s.p.z - this.oz) / cell));
      let a = this.cells.get(k);
      if (!a) this.cells.set(k, (a = []));
      a.push(i);
    });
  }

  _key(x, z) { return x * 73856093 + z * 19349663; }

  // horizontal distance from (x,z) to the nearest road edge (negative = on the road)
  // within maxR metres; returns {d, i, y} or null
  nearest(x, z, maxR = 60) {
    const c = this.cell;
    const cx = Math.floor((x - this.ox) / c), cz = Math.floor((z - this.oz) / c);
    const r = Math.ceil(maxR / c);
    let best = null, bd = Infinity;
    const S = this.track.samples;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const a = this.cells.get(this._key(cx + dx, cz + dz));
        if (!a) continue;
        for (const i of a) {
          const s = S[i];
          const ex = s.p.x - x, ez = s.p.z - z;
          const d = Math.sqrt(ex * ex + ez * ez) - s.hw;
          if (d < bd) { bd = d; best = i; }
        }
      }
    }
    if (best === null || bd > maxR) return null;
    return { d: bd, i: best, y: S[best].p.y };
  }

  // lowest road surface height covering (x,z) within a radius, or null
  roadAbove(x, z, r = 2) {
    const c = this.cell;
    const cx = Math.floor((x - this.ox) / c), cz = Math.floor((z - this.oz) / c);
    const S = this.track.samples;
    let low = null;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const a = this.cells.get(this._key(cx + dx, cz + dz));
      if (!a) continue;
      for (const i of a) {
        const s = S[i];
        const ex = s.p.x - x, ez = s.p.z - z;
        const lim = s.hw + r;
        if (ex * ex + ez * ez < lim * lim && (low === null || s.p.y < low)) low = s.p.y;
      }
    }
    return low;
  }
}
