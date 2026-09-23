// Tracks where a car is along the centreline. Searches a window around the last
// known sample (in 3D, so bridges and loops never confuse it) and only falls
// back to a full scan after a teleport.
export class Progress {
  constructor(track, index = 0) {
    this.track = track;
    this.index = index;
    this.dist = 0; // distance from the nearest sample
    this.lat = 0; // signed lateral offset (+ left)
    this.vert = 0; // height above the road plane
  }

  reset(index) { this.index = index; }

  update(pos) {
    const S = this.track.samples;
    const n = S.length;
    const closed = this.track.closed;
    let best = -1, bd = Infinity;
    const scan = (from, to) => {
      for (let k = from; k <= to; k++) {
        let i = k;
        if (closed) i = ((k % n) + n) % n;
        else if (i < 0 || i >= n) continue;
        const p = S[i].p;
        const dx = p.x - pos.x, dy = p.y - pos.y, dz = p.z - pos.z;
        // weight height a little more so a road stacked above never wins
        const d = dx * dx + dz * dz + dy * dy * 1.5;
        if (d < bd) { bd = d; best = i; }
      }
    };
    scan(this.index - 20, this.index + 60);
    if (bd > 30 * 30) {
      const wbest = best, wbd = bd;
      scan(0, n - 1);
      if (bd > wbd * 0.5) { best = wbest; bd = wbd; }
    }
    this.index = best;
    const sm = S[best];
    const rx = pos.x - sm.p.x, ry = pos.y - sm.p.y, rz = pos.z - sm.p.z;
    this.lat = rx * sm.l.x + ry * sm.l.y + rz * sm.l.z;
    this.vert = rx * sm.n.x + ry * sm.n.y + rz * sm.n.z;
    const along = rx * sm.t.x + ry * sm.t.y + rz * sm.t.z;
    this.dist = Math.sqrt(bd);
    this.s = sm.s + along;
    return best;
  }

  // off the road surface (outside the edges or well above/below it)?
  offRoad(margin = 1.5) {
    const sm = this.track.samples[this.index];
    return Math.abs(this.lat) > sm.hw + margin || this.vert < -2.5 || !sm.road;
  }
}
