// Builds render and collision geometry for a track from its sampled centreline.
// Output is plain typed arrays so it runs in Node (collision for the headless
// sim) and in the browser (wrapped into BufferGeometry by the renderer).
//
// Every face goes through quadN/triN, which take the intended outward normal
// and fix the winding to match - a reversed strip is back-face culled and
// silently invisible, so winding is never left to index order.
import { Vector3, Color } from 'three';
import { SURF } from './builder.js';
import { mulberry32, hashString, clamp } from '../util/math.js';

export const WALL_H = 1.15;
const WALL_T = 0.55;
const SLAB_T = 0.9;
const CURB_W = 0.85;
const LINE_W = 0.28;

const SURF_COL = { dirt: 0x8d6a45, ice: 0xbfe6f5, sand: 0xd9c08a, grass: 0x5f9a3c };

class Soup {
  constructor(rnd, jitter = 0.05) { this.pos = []; this.col = []; this.rnd = rnd; this.jitter = jitter; }
  tri(a, b, c, color) {
    const j = 1 + (this.rnd() - 0.5) * this.jitter;
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    const r = color.r * j, g = color.g * j, bl = color.b * j;
    this.col.push(r, g, bl, r, g, bl, r, g, bl);
  }
}

const _e1 = new Vector3(), _e2 = new Vector3(), _n = new Vector3();
function faceNormal(a, b, c) {
  _e1.subVectors(b, a); _e2.subVectors(c, a);
  return _n.crossVectors(_e1, _e2);
}

// marks: which of 'start', 'finish', 'cp' to draw (gates, checkers, grid); all by default
export function buildTrackGeometry(track, theme, { chunkLen = 160, marks = null } = {}) {
  const mark = (k) => !marks || marks.includes(k);
  const S = track.samples;
  const rnd = mulberry32(hashString(track.def.id + ':geo'));
  const col = (hex) => new Color(hex);
  const C = {
    road: col(theme.road), line: col(theme.line), curbA: col(theme.curbA), curbB: col(theme.curbB),
    shoulder: col(theme.shoulder), slab: col(theme.slab), slabDark: col(theme.slabDark), wall: col(theme.wall),
    wallA: col(theme.wallA), wallB: col(theme.wallB), pillar: col(theme.pillar), gate: col(theme.gate),
    banner: col(theme.banner), boost: col(theme.boost), boostDark: col(theme.boost).multiplyScalar(0.25),
    black: col(0x16181c), white: col(0xf4f4f4), light: col(0x2a2d33),
    neonL: col(theme.neonA ?? 0xff3df0), neonR: col(theme.neonB ?? 0x39e6ff),
  };
  const surfCol = {};
  for (const k in SURF_COL) surfCol[k] = col(SURF_COL[k]);
  const groundY = theme.ground === 'void' ? null : theme.ground === 'water' || theme.ground === 'lava' ? -2.2 : 0;
  const solidGround = groundY !== null && !(theme.ground === 'water' || theme.ground === 'lava');

  const chunks = [];
  const chunkOf = (s) => {
    const k = Math.floor(s / chunkLen);
    while (chunks.length <= k) chunks.push(new Soup(rnd));
    return chunks[k];
  };
  const decal = new Soup(rnd, 0.02);
  const glow = new Soup(rnd, 0);
  const coll = { pos: [], mat: [] };
  const ctri = (a, b, c, m) => { coll.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); coll.mat.push(m); };

  // quad with explicit outward normal; optionally also a collision quad
  function quadN(soup, a, b, c, d, want, color, mat = -1) {
    const n = faceNormal(a, b, c);
    if (n.dot(want) < 0) { const t = b; b = d; d = t; }
    soup.tri(a, b, c, color); soup.tri(a, c, d, color);
    if (mat >= 0) { ctri(a, b, c, mat); ctri(a, c, d, mat); }
  }
  function triN(soup, a, b, c, want, color, mat = -1) {
    const n = faceNormal(a, b, c);
    if (n.dot(want) < 0) { const t = b; b = c; c = t; }
    soup.tri(a, b, c, color);
    if (mat >= 0) ctri(a, b, c, mat);
  }

  const P = (sm, x, y) => sm.p.clone().addScaledVector(sm.l, x).addScaledVector(sm.n, y);
  const negL = (sm) => sm.l.clone().negate();
  const negN = (sm) => sm.n.clone().negate();

  // ---- decimate: keep samples where something changes -------------------
  const gateIdx = new Set([track.start.index, track.finish.index, ...track.checkpoints.map((c) => c.index)]);
  const keep = [0];
  for (let i = 1; i < S.length; i++) {
    const a = S[keep[keep.length - 1]], b = S[i];
    const flagsDiff = a.road !== b.road || a.surf !== b.surf || a.wallL !== b.wallL || a.wallR !== b.wallR ||
      a.boost !== b.boost || a.tunnel !== b.tunnel || a.piece !== b.piece;
    const turn = a.t.dot(b.t) < Math.cos(0.045) || a.n.dot(b.n) < Math.cos(0.045);
    const far = b.s - a.s > 7.5;
    const widen = Math.abs(a.hw - b.hw) > 0.05;
    const prev = S[i - 1];
    // keep the sample *before* a flag change too, so flat runs end exactly there
    if (flagsDiff && keep[keep.length - 1] !== i - 1) keep.push(i - 1);
    if (flagsDiff || turn || far || widen || gateIdx.has(i) || (prev && !prev.road && b.road)) keep.push(i);
  }
  if (keep[keep.length - 1] !== S.length - 1) keep.push(S.length - 1);
  const segs = [];
  for (let j = 0; j + 1 < keep.length; j++) segs.push([keep[j], keep[j + 1]]);
  if (track.closed) segs.push([keep[keep.length - 1], 0]);

  const heightAbove = (sm) => (groundY === null ? Infinity : sm.p.y - groundY);

  for (const [ia, ib] of segs) {
    const A = S[ia], B = S[ib];
    if (!A.road) continue;
    const soup = chunkOf(A.s);
    const onTurn = A.kind === 'T' || A.kind === 'LOOP';
    const stripe = Math.floor(((A.s + (ib === 0 ? track.length : B.s)) * 0.5) / 2.6) % 2 === 0;
    const hwA = A.hw, hwB = B.hw;
    const surfName = Object.keys(SURF).find((k) => SURF[k] === A.surf);
    const main = surfCol[surfName] || C.road;
    const up = A.n.clone().add(B.n).normalize();
    // lateral bands right -> left; an edge is [side, offset] meaning x = side*hw + offset
    const curb = onTurn ? (stripe ? C.curbA : C.curbB) : C.shoulder;
    const bands = [
      [[-1, 0], [-1, CURB_W], curb, SURF.line],
      [[-1, CURB_W], [-1, CURB_W + LINE_W], C.line, SURF.line],
      [[-1, CURB_W + LINE_W], [1, -CURB_W - LINE_W], main, A.surf],
      [[1, -CURB_W - LINE_W], [1, -CURB_W], C.line, SURF.line],
      [[1, -CURB_W], [1, 0], curb, SURF.line],
    ];
    for (const [e0, e1, color, mat] of bands) {
      const a0 = e0[0] * hwA + e0[1], a1 = e1[0] * hwA + e1[1];
      const b0 = e0[0] * hwB + e0[1], b1 = e1[0] * hwB + e1[1];
      quadN(soup, P(A, a0, 0), P(B, b0, 0), P(B, b1, 0), P(A, a1, 0), up, color, mat);
    }

    // neon edge strips (night themes)
    if (theme.neonEdges) {
      for (const side of [-1, 1]) {
        const e0 = side * (hwA - 0.05), e1 = side * (hwA - 0.3), f0 = side * (hwB - 0.05), f1 = side * (hwB - 0.3);
        quadN(glow, P(A, e0, 0.03), P(B, f0, 0.03), P(B, f1, 0.03), P(A, e1, 0.03), up, side < 0 ? C.neonR : C.neonL);
      }
    }
    // sides: wall, shoulder ramp or slab edge
    for (const side of [-1, 1]) {
      const hasWall = side < 0 ? A.wallR : A.wallL;
      const out = side < 0 ? negL(A) : A.l.clone();
      const ea = side * hwA, eb = side * hwB;
      if (hasWall) {
        const wc = onTurn ? (stripe ? C.wallA : C.wallB) : C.wall;
        const oa = side * (hwA + WALL_T), ob = side * (hwB + WALL_T);
        quadN(soup, P(A, ea, 0), P(B, eb, 0), P(B, eb, WALL_H), P(A, ea, WALL_H), out.clone().negate(), wc, SURF.wall);
        quadN(soup, P(A, ea, WALL_H), P(B, eb, WALL_H), P(B, ob, WALL_H), P(A, oa, WALL_H), up, wc, SURF.wall);
        quadN(soup, P(A, oa, WALL_H), P(B, ob, WALL_H), P(B, ob, -SLAB_T), P(A, oa, -SLAB_T), out, C.slab, SURF.structure);
      } else if (solidGround && heightAbove(A) < 0.7 && heightAbove(B) < 0.7 && A.kind !== 'LOOP') {
        // shoulder ramp down to the ground so the road reads as laid on the land
        const ramp = (sm, e) => {
          const o = sm.l.clone().setY(0).normalize().multiplyScalar(side * 1.4);
          const p = P(sm, e, 0).add(o);
          p.y = groundY - 0.02;
          return p;
        };
        quadN(soup, P(A, ea, 0), P(B, eb, 0), ramp(B, eb), ramp(A, ea), up.clone().add(out).normalize(), C.slabDark, SURF.grass);
      } else {
        quadN(soup, P(A, ea, 0), P(B, eb, 0), P(B, eb, -SLAB_T), P(A, ea, -SLAB_T), out, C.slab, SURF.structure);
      }
    }
    // underside
    if (!(solidGround && heightAbove(A) < 0.7 && heightAbove(B) < 0.7)) {
      const wa = (sm, side) => side * (sm.hw + ((side < 0 ? sm.wallR : sm.wallL) ? WALL_T : 0));
      quadN(soup, P(A, wa(A, -1), -SLAB_T), P(B, wa(B, -1), -SLAB_T), P(B, wa(B, 1), -SLAB_T), P(A, wa(A, 1), -SLAB_T),
        up.clone().negate(), C.slabDark, SURF.structure);
    }
    // tunnel shell: vertical sides from the slab bottom, then a faceted arch
    if (A.tunnel) {
      const ringPts = (sm) => {
        const R = sm.hw + (sm.wallL || sm.wallR ? WALL_T : 0) + 0.9, TH = 6.2, h0 = WALL_H + 1.6;
        const pts = [P(sm, -R, -SLAB_T)];
        for (let k = 0; k <= 6; k++) {
          const ang = (k / 6) * Math.PI; // right -> left
          pts.push(P(sm, -Math.cos(ang) * R, h0 + Math.sin(ang) * TH));
        }
        pts.push(P(sm, R, -SLAB_T));
        return pts;
      };
      const ra = ringPts(A), rb = ringPts(B);
      for (let k = 0; k + 1 < ra.length; k++) {
        const a0 = ra[k], a1 = ra[k + 1], b0 = rb[k], b1 = rb[k + 1];
        const mid = a0.clone().add(a1).multiplyScalar(0.5);
        const inward = A.p.clone().addScaledVector(A.n, WALL_H + 1).sub(mid).normalize();
        quadN(soup, a0, b0, b1, a1, inward, k % 2 ? C.slab : C.slabDark, SURF.structure);
        quadN(soup, a0, b0, b1, a1, inward.clone().negate(), C.pillar);
      }
    }
  }

  // ---- end caps where the road stops (kicker lips, sprint ends) ----------
  for (let i = 0; i < S.length; i++) {
    const sm = S[i];
    if (!sm.road) continue;
    const next = S[i + 1] || (track.closed ? S[0] : null);
    const prev = S[i - 1] || (track.closed ? S[S.length - 1] : null);
    const capAt = (s, dir) => {
      const soup = chunkOf(s.s);
      const hw = s.hw;
      quadN(soup, P(s, -hw, 0), P(s, hw, 0), P(s, hw, -SLAB_T), P(s, -hw, -SLAB_T), dir, C.slabDark, SURF.structure);
    };
    if (!next || !next.road) {
      // the lip is the first gap sample; cap there
      capAt(next && !next.road ? next : sm, sm.t.clone());
    }
    if (!prev || (!prev.road && i > 0)) capAt(sm, sm.t.clone().negate());
  }
  // ---- kicker warning stripes (decal) ---------------------------------------
  for (let i = 0; i < S.length; i++) {
    const sm = S[i];
    if (sm.kind !== 'K' || !sm.road) continue;
    const nx = S[i + 1];
    if (!nx) continue;
    const band = Math.floor(sm.s / 1.2) % 2 === 0;
    if (sm.u < 0.55) continue;
    const up = sm.n;
    const h = 0.03;
    quadN(decal, P(sm, -sm.hw + CURB_W, h), P(nx, -nx.hw + CURB_W, h), P(nx, nx.hw - CURB_W, h), P(sm, sm.hw - CURB_W, h), up,
      band ? col(0xffc21a) : C.black);
  }

  // ---- boost pads (glow decals) ------------------------------------------
  const pads = [];
  for (let i = 0; i < S.length; i++) {
    if (!S[i].boost) continue;
    let j = i;
    while (j + 1 < S.length && S[j + 1].boost) j++;
    pads.push([i, j]);
    i = j;
  }
  for (const [i0, i1] of pads) {
    const h = 0.035;
    for (let i = i0; i < i1; i++) {
      const A = S[i], B = S[i + 1];
      const wA = A.hw - CURB_W - LINE_W - 0.3, wB = B.hw - CURB_W - LINE_W - 0.3;
      quadN(glow, P(A, -wA, h), P(B, -wB, h), P(B, wB, h), P(A, wA, h), A.n, C.boostDark);
    }
    // chevrons: each "^" is two parallelogram bars meeting at a forward tip
    const s0 = S[i0].s, s1 = S[i1].s;
    const L = 3.2, bw = 1.1;
    for (let s = s0 + 0.6; s + L + bw < s1; s += 3.6) {
      const f0 = frameAt(track, s);
      const w = Math.min(f0.hw - CURB_W - LINE_W - 1.0, 2.6);
      const at = (x, ds) => {
        const f = frameAt(track, s + ds);
        return f.p.clone().addScaledVector(f.l, x).addScaledVector(f.n, 0.05);
      };
      for (const side of [-1, 1]) {
        quadN(glow, at(side * w, 0), at(0, L), at(0, L + bw), at(side * w, bw), f0.n, C.boost);
      }
    }
  }

  // ---- start grid + finish checker ----------------------------------------
  const checker = (gate, rows, size) => {
    const f = frameAt(track, gate.s);
    const hw = f.hw - CURB_W;
    const cols = Math.max(2, Math.round((hw * 2) / size));
    const cw = (hw * 2) / cols;
    for (let r = 0; r < rows; r++) {
      const fa = frameAt(track, gate.s + (r - rows / 2) * size), fb = frameAt(track, gate.s + (r + 1 - rows / 2) * size);
      for (let c = 0; c < cols; c++) {
        const x0 = -hw + c * cw, x1 = x0 + cw;
        const pt = (fr, x) => fr.p.clone().addScaledVector(fr.l, x).addScaledVector(fr.n, 0.03);
        quadN(decal, pt(fa, x0), pt(fb, x0), pt(fb, x1), pt(fa, x1), fa.n, (r + c) % 2 ? C.black : C.white);
      }
    }
  };
  if (track.closed ? mark('start') : mark('finish')) checker(track.finish, 2, 1.1);
  if (!track.closed && mark('start')) checker(track.start, 1, 0.9);
  // grid boxes behind the start line
  for (let slot = 0; slot < (mark('start') ? 8 : 0); slot++) {
    const g = gridSlot(track, slot);
    const f = frameAt(track, g.s + 2.6);
    const f2 = frameAt(track, g.s + 2.9);
    const pt = (fr, x) => fr.p.clone().addScaledVector(fr.l, x).addScaledVector(fr.n, 0.03);
    quadN(decal, pt(f, g.x - 1.3), pt(f2, g.x - 1.3), pt(f2, g.x + 1.3), pt(f, g.x + 1.3), f.n, C.line);
  }

  // ---- gates -------------------------------------------------------------
  const gates = [];
  const box = (soup, center, ax, ay, az, hx, hy, hz, color, mat = -1) => {
    // oriented box: axes ax (lateral), ay (up), az (forward), half sizes
    const corner = (sx, sy, sz) => center.clone().addScaledVector(ax, sx * hx).addScaledVector(ay, sy * hy).addScaledVector(az, sz * hz);
    const faces = [
      [[1, -1, -1], [1, -1, 1], [1, 1, 1], [1, 1, -1], ax],
      [[-1, -1, -1], [-1, 1, -1], [-1, 1, 1], [-1, -1, 1], ax.clone().negate()],
      [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1], ay],
      [[-1, -1, -1], [-1, -1, 1], [1, -1, 1], [1, -1, -1], ay.clone().negate()],
      [[-1, -1, 1], [-1, 1, 1], [1, 1, 1], [1, -1, 1], az],
      [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], az.clone().negate()],
    ];
    for (const [a, b, c, d, n] of faces) quadN(soup, corner(...a), corner(...b), corner(...c), corner(...d), n, color, mat);
  };
  const gateAt = (g, kind) => {
    const soup = chunkOf(g.s);
    const f = frameAt(track, g.s);
    const up = new Vector3(0, 1, 0);
    const lat = f.l.clone().setY(0).normalize();
    const fwd = new Vector3().crossVectors(lat, up).normalize().negate();
    if (fwd.dot(f.t) < 0) fwd.negate();
    const span = f.hw + (f.wallL || f.wallR ? WALL_T + 0.6 : 0.9);
    const H = kind === 'start' || kind === 'finish' ? 7.6 : 6.6;
    const postCol = kind === 'cp' ? C.gate : C.light;
    for (const side of [-1, 1]) {
      const base = f.p.clone().addScaledVector(lat, side * span);
      const bottom = groundY === null ? base.y - SLAB_T : Math.min(base.y - SLAB_T, groundY);
      const center = base.clone(); center.y = (bottom + base.y + H) / 2;
      box(soup, center, lat, up, fwd, 0.45, (base.y + H - bottom) / 2, 0.45, postCol, SURF.structure);
    }
    const beamC = f.p.clone().addScaledVector(up, H - 0.5);
    box(soup, beamC, lat, up, fwd, span + 0.45, 0.55, 0.35, postCol);
    // banner faces
    const bh = 0.9, bw = span - 0.2;
    for (const face of [-1, 1]) {
      const n = fwd.clone().multiplyScalar(face);
      const o = beamC.clone().addScaledVector(fwd, face * 0.37);
      if (kind === 'cp') {
        quadN(glow, o.clone().addScaledVector(lat, -bw).addScaledVector(up, -bh / 2), o.clone().addScaledVector(lat, bw).addScaledVector(up, -bh / 2),
          o.clone().addScaledVector(lat, bw).addScaledVector(up, bh / 2), o.clone().addScaledVector(lat, -bw).addScaledVector(up, bh / 2), n, C.banner);
      } else {
        const cols = Math.round(bw * 2 / 0.5);
        const cw = (bw * 2) / cols;
        for (let r = 0; r < 2; r++) for (let c = 0; c < cols; c++) {
          const x0 = -bw + c * cw, y0 = -bh / 2 + r * (bh / 2);
          const pa = o.clone().addScaledVector(lat, x0).addScaledVector(up, y0);
          quadN(soup, pa, pa.clone().addScaledVector(lat, cw), pa.clone().addScaledVector(lat, cw).addScaledVector(up, bh / 2),
            pa.clone().addScaledVector(up, bh / 2), n, (r + c) % 2 ? C.black : C.white);
        }
      }
    }
    gates.push({ kind, s: g.s, center: beamC.clone(), lat: lat.clone(), up: up.clone(), fwd: fwd.clone(), span, H });
  };
  if (mark('start')) gateAt(track.start, 'start');
  if (!track.closed && mark('finish')) gateAt(track.finish, 'finish');
  if (mark('cp')) track.checkpoints.forEach((cp) => gateAt(cp, 'cp'));

  // ---- pillars under elevated road ----------------------------------------
  if (groundY !== null) {
    const hexR = 0.75;
    let lastS = -Infinity;
    for (let i = 0; i < S.length; i++) {
      const sm = S[i];
      if (!sm.road || sm.kind === 'LOOP' || sm.kind === 'J') continue;
      if (sm.s - lastS < 16) continue;
      const bottom = sm.p.y - SLAB_T * sm.n.y - groundY;
      if (bottom < 1.6 || sm.n.y < 0.7) continue;
      const offs = sm.hw > 6 ? [-sm.hw * 0.55, sm.hw * 0.55] : [0];
      let placed = false;
      for (const x of offs) {
        const top = P(sm, x, -SLAB_T + 0.05);
        if (blockedBelow(track, top, sm.s, hexR + 0.5)) continue;
        const soup = chunkOf(sm.s);
        for (let k = 0; k < 6; k++) {
          const a0 = (k / 6) * Math.PI * 2, a1 = ((k + 1) / 6) * Math.PI * 2;
          const d0 = new Vector3(Math.cos(a0), 0, Math.sin(a0)), d1 = new Vector3(Math.cos(a1), 0, Math.sin(a1));
          const t0 = top.clone().addScaledVector(d0, hexR), t1 = top.clone().addScaledVector(d1, hexR);
          const b0 = t0.clone(); b0.y = groundY - 0.3;
          const b1 = t1.clone(); b1.y = groundY - 0.3;
          quadN(soup, b0, b1, t1, t0, d0.clone().add(d1).normalize(), k % 2 ? C.pillar : C.slab, SURF.structure);
        }
        placed = true;
      }
      if (placed) lastS = sm.s;
    }
  }

  const pack = (soup) => ({ pos: new Float32Array(soup.pos), col: new Float32Array(soup.col) });
  return {
    chunks: chunks.filter((c) => c.pos.length).map(pack),
    decal: pack(decal),
    glow: pack(glow),
    collision: { pos: coll.pos, mat: coll.mat },
    gates,
  };
}

// is there another stretch of road between this pillar top and the ground?
function blockedBelow(track, top, s, r) {
  for (const sm of track.samples) {
    if (!sm.road || Math.abs(sm.s - s) < 25) continue;
    if (sm.p.y > top.y - 0.5) continue;
    const dx = sm.p.x - top.x, dz = sm.p.z - top.z;
    const lim = sm.hw + r + 1.5;
    if (dx * dx + dz * dz < lim * lim) return true;
  }
  return false;
}

// Interpolated frame at distance s along the centreline (wraps on circuits).
export function frameAt(track, s) {
  const S = track.samples;
  if (track.closed) { s %= track.length; if (s < 0) s += track.length; }
  else s = clamp(s, 0, S[S.length - 1].s);
  let lo = 0, hi = S.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (S[mid].s <= s) lo = mid; else hi = mid - 1;
  }
  const a = S[lo];
  const b = S[lo + 1] || (track.closed ? S[0] : a);
  const segLen = (b === S[0] && track.closed ? track.length : b.s) - a.s;
  const t = segLen > 1e-6 ? clamp((s - a.s) / segLen, 0, 1) : 0;
  return {
    p: a.p.clone().lerp(b.p, t),
    t: a.t.clone().lerp(b.t, t).normalize(),
    n: a.n.clone().lerp(b.n, t).normalize(),
    l: a.l.clone().lerp(b.l, t).normalize(),
    hw: a.hw + (b.hw - a.hw) * t,
    wallL: a.wallL, wallR: a.wallR, road: a.road, index: lo, s,
  };
}

// Grid slot k: two columns, rows every 7.5 m behind the start line.
export function gridSlot(track, k) {
  const row = Math.floor(k / 2), colm = k % 2;
  const f = frameAt(track, track.start.s);
  const x = (colm === 0 ? 1 : -1) * Math.min(3.2, f.hw * 0.4);
  return { s: track.start.s - 4.5 - row * 7.5 - colm * 2.5, x };
}
