// Custom tracks: the editable piece model, automatic circuit closing, checks,
// the local library, and share codes / files. A custom track is an ordinary
// track definition (a list of piece strings, see builder.js) with custom: true,
// so everything that races the built-in tracks races these too.
//
// Anything that arrives from outside - a pasted code, a file, a host in an
// online room - goes through sanitize() before it touches the builder.
import { parsePiece, buildTrack } from './builder.js';
import { THEMES } from './themes.js';
import { load, save } from '../util/storage.js';
import { hashString, clamp, DEG } from '../util/math.js';
import { solveRoute, routeDef, packBlock, unpackBlock, blockCells, cellKey, LIMITS as BLIMITS } from './blocks.js';

export const LIMITS = {
  pieces: 120, // user pieces (the closing section is extra)
  length: 8000, // metres of road (your pieces; the closing section is extra)
  name: 32,
};

// ---- the editable piece model -------------------------------------------------
// { type: 'S'|'L'|'R'|'K'|'J'|'LOOP', len, deg, r, bank, dh, w, lip, loopR, off,
//   surface, walls, cp, boost, tunnel }

export const SURFACES = ['asphalt', 'dirt', 'ice', 'sand', 'grass'];
export const WALLS = ['auto', 'both', 'left', 'right', 'none'];
const WALL_TOKEN = { both: 'wall', none: 'nowall', left: 'wallL', right: 'wallR' };
const WALL_FROM = { both: 'both', none: 'none', left: 'left', right: 'right' };

// allowed ranges per field (also used to clamp anything imported)
export const RANGE = {
  len: { S: [5, 400], K: [6, 24], J: [8, 60] },
  deg: [1, 360],
  r: [12, 250],
  bank: [-25, 25],
  dh: { S: [-30, 30], T: [-30, 30], J: [-14, 6] },
  w: [8, 26],
  lip: [4, 18],
  loopR: [8, 20],
  off: [-40, 40],
};

const num = (v, lo, hi, fallback) => (Number.isFinite(+v) ? clamp(+v, lo, hi) : fallback);
const r1 = (v) => Math.round(v * 10) / 10;

export function defaultPiece(type) {
  switch (type) {
    case 'S': return { type, len: 60, dh: 0 };
    case 'L': case 'R': return { type, deg: 90, r: 45, bank: 0, dh: 0 };
    case 'K': return { type, len: 12, lip: 12 };
    case 'J': return { type, len: 26, dh: -2 };
    case 'LOOP': return { type, loopR: 12, off: 18 };
    default: throw new Error('unknown piece ' + type);
  }
}

// piece object -> DSL string (see builder.js for the grammar)
export function pieceString(p) {
  const f = (v) => String(r1(v));
  let s;
  if (p.type === 'S') s = `S ${f(p.len)}`;
  else if (p.type === 'L' || p.type === 'R') s = `${p.type} ${f(p.deg)} r${f(p.r)}${p.bank ? ` b${f(p.bank)}` : ''}`;
  else if (p.type === 'K') s = `K ${f(p.len)} a${f(p.lip)}`;
  else if (p.type === 'J') s = `J ${f(p.len)}`;
  else if (p.type === 'LOOP') s = `LOOP r${f(p.loopR)}${p.off != null ? ` o${f(p.off)}` : ''}`;
  else throw new Error('unknown piece ' + p.type);
  if (p.type !== 'K' && p.type !== 'LOOP' && p.dh) s += p.dh > 0 ? ` u${f(p.dh)}` : ` d${f(-p.dh)}`;
  if (p.w) s += ` w${f(p.w)}`;
  if (p.cp) s += ' cp';
  if (p.boost) s += ' boost';
  if (p.surface && p.surface !== 'asphalt') s += ' ' + p.surface;
  if (p.walls && p.walls !== 'auto') s += ' ' + WALL_TOKEN[p.walls];
  if (p.tunnel) s += ' tunnel';
  return s;
}

// DSL string -> piece object (throws on anything the builder wouldn't accept)
export function pieceFromString(str, def = {}) {
  const q = parsePiece(String(str), { id: def.id || 'custom', radius: 40 });
  const p = {};
  if (q.type === 'T') { p.type = q.turn > 0 ? 'L' : 'R'; p.deg = Math.abs(q.turn) / DEG; p.r = q.radius; p.bank = q.bank || 0; p.dh = q.dh || 0; }
  else if (q.type === 'S') { if (q.auto) throw new Error('"S ?" is not used in custom tracks'); p.type = 'S'; p.len = q.len; p.dh = q.dh || 0; }
  else if (q.type === 'K') { p.type = 'K'; p.len = q.len; p.lip = q.lip; }
  else if (q.type === 'J') { p.type = 'J'; p.len = q.len; p.dh = q.dh || 0; }
  else if (q.type === 'LOOP') { p.type = 'LOOP'; p.loopR = q.loopR; p.off = q.offset; }
  if (q.width != null) p.w = q.width;
  if (q.cp) p.cp = true;
  if (q.boost) p.boost = true;
  if (q.surface && q.surface !== 'asphalt') p.surface = q.surface;
  if (q.walls) p.walls = WALL_FROM[q.walls];
  if (q.tunnel) p.tunnel = true;
  return clampPiece(p);
}

export function clampPiece(p) {
  const t = p.type;
  const o = { type: t };
  if (t === 'S' || t === 'K' || t === 'J') o.len = r1(num(p.len, RANGE.len[t][0], RANGE.len[t][1], defaultPiece(t).len));
  if (t === 'L' || t === 'R') {
    o.deg = r1(num(p.deg, RANGE.deg[0], RANGE.deg[1], 90));
    o.r = r1(num(p.r, RANGE.r[0], RANGE.r[1], 45));
    o.bank = r1(num(p.bank, RANGE.bank[0], RANGE.bank[1], 0));
  }
  if (t === 'S' || t === 'L' || t === 'R' || t === 'J') {
    const [lo, hi] = RANGE.dh[t === 'J' ? 'J' : t === 'S' ? 'S' : 'T'];
    o.dh = r1(num(p.dh, lo, hi, 0));
  }
  if (t === 'K') o.lip = r1(num(p.lip, RANGE.lip[0], RANGE.lip[1], 12));
  if (t === 'LOOP') { o.loopR = r1(num(p.loopR, RANGE.loopR[0], RANGE.loopR[1], 12)); o.off = p.off == null ? null : r1(num(p.off, RANGE.off[0], RANGE.off[1], 18)); }
  if (p.w != null) o.w = r1(num(p.w, RANGE.w[0], RANGE.w[1], 14));
  if (p.cp) o.cp = true;
  if (p.boost && t !== 'J') o.boost = true;
  if (SURFACES.includes(p.surface) && p.surface !== 'asphalt') o.surface = p.surface;
  if (WALLS.includes(p.walls) && p.walls !== 'auto') o.walls = p.walls;
  if (p.tunnel && t !== 'J') o.tunnel = true;
  return o;
}

// ---- track definitions --------------------------------------------------------
export const THEME_IDS = Object.keys(THEMES);

// A new track: a start straight and a gentle loop of corners (closes itself).
export function templateDef(name = 'My Track') {
  return {
    name, theme: 'meadow', laps: 3, width: 14, walls: 'turns', difficulty: 1,
    pieces: ['S 80', 'R 90 r45', 'S 60', 'R 90 r45 cp', 'S 120', 'L 60 r50'],
  };
}

// Everything that describes the layout, in a stable order (drives the id).
function layoutKey(d) {
  return JSON.stringify([d.theme, d.laps, d.width, d.walls, d.pieces]);
}

// Clean an untrusted definition into a safe one, or throw with a reason.
export function sanitize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Not a track.');
  if (Array.isArray(raw.blocks)) return sanitizeBlocks(raw);
  if (!Array.isArray(raw.pieces) || !raw.pieces.length) throw new Error('The track has no pieces.');
  if (raw.pieces.length > LIMITS.pieces + 4) throw new Error(`Too many pieces (max ${LIMITS.pieces}).`);
  const def = {
    name: String(raw.name ?? 'Custom track').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, LIMITS.name) || 'Custom track',
    author: raw.author ? String(raw.author).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) : undefined,
    theme: THEME_IDS.includes(raw.theme) ? raw.theme : 'meadow',
    laps: Math.round(num(raw.laps, 0, 9, 0)),
    width: r1(num(raw.width, RANGE.w[0], RANGE.w[1], 14)),
    walls: ['turns', 'all', 'none'].includes(raw.walls) ? raw.walls : 'turns',
    difficulty: Math.round(num(raw.difficulty, 0, 3, 1)),
    pieces: [],
  };
  const parsed = [];
  let metres = 0;
  for (const s of raw.pieces) {
    if (typeof s !== 'string' || s.length > 64) throw new Error('A piece is not valid.');
    const p = pieceFromString(s, def);
    metres += p.type === 'L' || p.type === 'R' ? p.deg * DEG * p.r : p.type === 'LOOP' ? 2 * Math.PI * p.loopR : p.len;
    parsed.push(p);
  }
  if (metres > LIMITS.length) throw new Error(`The track is too long (max ${LIMITS.length / 1000} km).`);
  // loops always carry their sideways shift explicitly (the builder's default
  // depends on the road width at that point)
  const W = widthsAtStart(def.width, parsed);
  parsed.forEach((p, k) => { if (p.type === 'LOOP' && p.off == null) p.off = r1(clamp(W[k] + 4, RANGE.off[0], RANGE.off[1])); });
  def.pieces = parsed.map(pieceString);
  if (raw.medals && typeof raw.medals === 'object') {
    const m = {};
    for (const k of ['author', 'gold', 'silver', 'bronze']) { const v = +raw.medals[k]; if (Number.isFinite(v) && v > 1000 && v < 3600e3) m[k] = Math.round(v); }
    if (m.author && m.gold && m.silver && m.bronze) def.medals = m;
  }
  return finalize(def);
}

// ---- block tracks (the 3D track builder) ---------------------------------------------
// The blocks are the source; the route pieces are always worked out again from
// them, never taken from outside.
function cleanMeta(raw) {
  const meta = {
    name: String(raw.name ?? 'Custom track').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, LIMITS.name) || 'Custom track',
    author: raw.author ? String(raw.author).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) : undefined,
    theme: THEME_IDS.includes(raw.theme) ? raw.theme : 'meadow',
    laps: Math.round(num(raw.laps, 1, 9, 3)),
    difficulty: Math.round(num(raw.difficulty, 0, 3, 1)),
  };
  if (raw.medals && typeof raw.medals === 'object') {
    const m = {};
    for (const k of ['author', 'gold', 'silver', 'bronze']) { const v = +raw.medals[k]; if (Number.isFinite(v) && v > 1000 && v < 3600e3) m[k] = Math.round(v); }
    if (m.author && m.gold && m.silver && m.bronze) meta.medals = m;
  }
  return meta;
}

function sanitizeBlocks(raw) {
  if (raw.blocks.length > BLIMITS.blocks) throw new Error(`Too many blocks (max ${BLIMITS.blocks}).`);
  const blocks = raw.blocks.map(unpackBlock);
  if (blocks.some((b) => !b)) throw new Error('A block is not valid.');
  const occ = new Map();
  for (const b of blocks) for (const [x, y, z] of blockCells(b)) { const k = cellKey(x, y, z); if (occ.has(k)) throw new Error('Two blocks overlap.'); occ.set(k, 1); }
  return blockDef(cleanMeta(raw), blocks);
}

// meta + blocks -> a full definition (route pieces, start placement, id)
export function blockDef(meta, blocks) {
  const route = solveRoute(blocks);
  const packed = blocks.map(packBlock);
  const def = { ...meta, ...routeDef(meta, blocks, route), blocks: packed, custom: true, routeOk: route.ok };
  if (!route.ok) def.laps = 0;
  if (!def.author) delete def.author;
  if (!def.medals) delete def.medals;
  def.id = 'b-' + hashString(JSON.stringify([meta.theme, route.closed ? meta.laps : 0, packed])).toString(36);
  return def;
}

// road width at the start of every piece, exactly as the builder works it out
// (jump gaps widen the landing, then it funnels back)
function widthsAtStart(base, P) {
  const N = P.length;
  const W = new Array(N + 1).fill(base);
  for (let k = 0; k < N; k++) {
    W[k + 1] = P[k].w ?? W[k];
    if (P[k].type === 'J') {
      const normal = W[k];
      W[k + 1] = normal + 6;
      if (k + 1 < N && P[k + 1].w == null) { W[k + 2] = normal; k++; }
    }
  }
  return W;
}

// Give a definition its derived fields: custom flag, content id, closing section.
export function finalize(def) {
  const d = { ...def, custom: true };
  if (!d.author) delete d.author;
  if (!d.medals) delete d.medals;
  d.id = 'c-' + hashString(layoutKey(d)).toString(36);
  return d;
}

// ---- automatic circuit closing ------------------------------------------------
// The shortest smooth way back to the start line (a Dubins path: turn, straight,
// turn - or three turns) with a fixed corner radius, plus whatever rise or fall
// brings the road back to its starting height.
export function endPose(def) {
  let x = 0, z = 0, yaw = 0, h = 0;
  const width = def.width ?? 14;
  for (const s of def.pieces) {
    const p = parsePiece(s, { id: 'custom', radius: 40 });
    h += p.dh;
    if (p.type === 'T') {
      const sg = Math.sign(p.turn);
      x += sg * p.radius * (Math.cos(yaw) - Math.cos(yaw + p.turn));
      z += sg * p.radius * (-Math.sin(yaw) + Math.sin(yaw + p.turn));
      yaw += p.turn;
    } else if (p.type === 'LOOP') {
      const off = p.offset ?? width + 4; // + shifts right
      x -= Math.cos(yaw) * off; z += Math.sin(yaw) * off;
    } else {
      x += Math.sin(yaw) * p.len; z += Math.cos(yaw) * p.len;
    }
  }
  return { x, z, yaw, h };
}

const TAU = Math.PI * 2;
const mod2pi = (a) => ((a % TAU) + TAU) % TAU;

// Dubins words from pose (x0,y0,th0) to (x1,y1,th1) with unit radius after
// scaling; returns [{ kind: 'L'|'S'|'R', v }] with turn angles in radians and
// straights in metres. Coordinates here: u = z, v = x, heading = yaw, left = CCW.
function dubins(x0, y0, th0, x1, y1, th1, rho) {
  const dx = x1 - x0, dy = y1 - y0;
  const d = Math.hypot(dx, dy) / rho;
  const th = Math.atan2(dy, dx);
  const a = mod2pi(th0 - th), b = mod2pi(th1 - th);
  const sa = Math.sin(a), sb = Math.sin(b), ca = Math.cos(a), cb = Math.cos(b), cab = Math.cos(a - b);
  const words = [];
  { // LSL
    const p2 = 2 + d * d - 2 * cab + 2 * d * (sa - sb);
    if (p2 >= 0) { const t1 = Math.atan2(cb - ca, d + sa - sb); words.push(['L', mod2pi(t1 - a), 'S', Math.sqrt(p2), 'L', mod2pi(b - t1)]); }
  }
  { // RSR
    const p2 = 2 + d * d - 2 * cab + 2 * d * (sb - sa);
    if (p2 >= 0) { const t1 = Math.atan2(ca - cb, d - sa + sb); words.push(['R', mod2pi(a - t1), 'S', Math.sqrt(p2), 'R', mod2pi(t1 - b)]); }
  }
  { // LSR
    const p2 = -2 + d * d + 2 * cab + 2 * d * (sa + sb);
    if (p2 >= 0) { const p = Math.sqrt(p2); const t2 = Math.atan2(-ca - cb, d + sa + sb) - Math.atan2(-2, p); words.push(['L', mod2pi(t2 - a), 'S', p, 'R', mod2pi(t2 - b)]); }
  }
  { // RSL
    const p2 = d * d - 2 + 2 * cab - 2 * d * (sa + sb);
    if (p2 >= 0) { const p = Math.sqrt(p2); const t2 = Math.atan2(ca + cb, d - sa - sb) - Math.atan2(2, p); words.push(['R', mod2pi(a - t2), 'S', p, 'L', mod2pi(b - t2)]); }
  }
  { // RLR
    const t0 = (6 - d * d + 2 * cab + 2 * d * (sa - sb)) / 8;
    if (Math.abs(t0) <= 1) { const p = mod2pi(TAU - Math.acos(t0)); const t = mod2pi(a - Math.atan2(ca - cb, d - sa + sb) + p / 2); words.push(['R', t, 'L', p, 'R', mod2pi(a - b - t + p)]); }
  }
  { // LRL
    const t0 = (6 - d * d + 2 * cab + 2 * d * (sb - sa)) / 8;
    if (Math.abs(t0) <= 1) { const p = mod2pi(TAU - Math.acos(t0)); const t = mod2pi(-a - Math.atan2(ca - cb, d + sa - sb) + p / 2); words.push(['L', t, 'R', p, 'L', mod2pi(b - a - t + p)]); }
  }
  let best = null, bl = Infinity;
  for (const w of words) {
    const len = w[1] + w[3] + w[5];
    if (len < bl) { bl = len; best = w; }
  }
  if (!best) return null;
  return [0, 2, 4].map((k) => ({ kind: best[k], v: best[k] === 'S' ? best[k + 1] * rho : best[k + 1] }));
}

export const CLOSE_RADIUS = 42;

// Pieces that bring a circuit back to its start (none for sprints).
export function closingPieces(def, radius = CLOSE_RADIUS) {
  if (!(def.laps > 0) || def._built) return [];
  const e = endPose(def);
  // already back at the start, facing the right way: nothing to add (a Dubins
  // solver would otherwise happily add a full circle)
  const yawOff = Math.abs(((e.yaw % TAU) + TAU + Math.PI) % TAU - Math.PI);
  if (Math.hypot(e.x, e.z) < 0.5 && yawOff < 0.01 && Math.abs(e.h) < 0.05) return [];
  // u = z, v = x; heading measured from +z toward +x (yaw)
  const path = dubins(e.z, e.x, e.yaw, 0, 0, 0, radius);
  if (!path) return [];
  const out = [];
  let total = 0;
  for (const seg of path) {
    if (seg.kind === 'S') { if (seg.v > 0.05) { out.push({ type: 'S', len: seg.v, dh: 0 }); total += seg.v; } }
    else if (seg.v > 1e-4) { out.push({ type: seg.kind, deg: seg.v / DEG, r: radius, bank: 0, dh: 0 }); total += seg.v * radius; }
  }
  // share the height correction out by length
  if (Math.abs(e.h) > 0.05 && total > 0) {
    let left = -e.h;
    out.forEach((p, i) => {
      const len = p.type === 'S' ? p.len : (p.deg * DEG) * p.r;
      const dh = i === out.length - 1 ? left : Math.round((-e.h * len / total) * 10) / 10;
      p.dh = dh;
      left -= dh;
    });
  }
  return out;
}

// closing pieces are written with more precision than user pieces, so the lap
// closes to a hair
export function closingStrings(def) {
  return closingPieces(def).map((p) => {
    const dh = p.dh ? (p.dh > 0 ? ` u${r1(p.dh)}` : ` d${r1(-p.dh)}`) : '';
    if (p.type === 'S') return `S ${p.len.toFixed(3)}${dh}`;
    return `${p.type} ${p.deg.toFixed(4)} r${p.r}${dh}`;
  });
}

// ---- checks ---------------------------------------------------------------------
// Builds the track and reports what would make it unfair or broken.
// Returns { track, errors: [text], warnings: [{ text, piece }], marks: [Vector3] }.
export function checkDef(def) {
  const errors = [], warnings = [], marks = [];
  let track = null;
  if (!def.pieces.length) errors.push('Add some pieces.');
  if (def.pieces.length > LIMITS.pieces) errors.push(`Too many pieces (max ${LIMITS.pieces}).`);
  const first = def.pieces[0] && pieceFromStringSafe(def.pieces[0]);
  if (first && (first.type !== 'S' || first.len < 40)) errors.push('The first piece must be a straight of at least 40 m (the starting grid).');
  if (!errors.length) {
    try {
      track = buildTrack(buildDef(def));
    } catch (e) {
      errors.push(e.message.replace(/^track [^:]+: /, ''));
    }
  }
  if (track) {
    if (track.length > LIMITS.length) errors.push(`Too long: ${(track.length / 1000).toFixed(1)} km (max ${LIMITS.length / 1000} km).`);
    if (track.length < 250) errors.push('Too short - make it at least 250 m.');
    const n = def.pieces.length;
    const P = track.pieces;
    // kickers want a straight, settled run-up; gaps want a kicker
    P.forEach((p, k) => {
      if (k >= n) return;
      if (p.type === 'K') {
        let run = 0;
        for (let j = k - 1; j >= 0 && P[j].type === 'S'; j--) run += P[j].len;
        if (run < 50) warnings.push({ text: `Ramp ${k + 1} has only ${Math.round(run)} m of straight before it - cars may launch crooked.`, piece: k });
      }
      if (p.type === 'J' && (k === 0 || P[k - 1].type !== 'K')) warnings.push({ text: `Gap ${k + 1} has no ramp before it - cars will drop in.`, piece: k });
      if (p.type === 'LOOP') {
        let run = 0;
        for (let j = k - 1; j >= 0 && P[j].type === 'S'; j--) run += P[j].len;
        if (run < 60) warnings.push({ text: `Loop ${k + 1} needs a longer straight before it to carry speed.`, piece: k });
      }
      if ((p.type === 'S' || p.type === 'T') && p.len > 0 && Math.abs(p.dh) / p.len > 0.3) warnings.push({ text: `Piece ${k + 1} is very steep.`, piece: k });
      if (p.type === 'T' && p.radius < 20 && Math.abs(p.turn) > 60 * DEG) warnings.push({ text: `Turn ${k + 1} is a very tight hairpin.`, piece: k });
    });
    // road crossing itself at nearly the same height
    const S = track.samples;
    let clash = null;
    for (let i = 0; i < S.length && !clash; i += 3) {
      if (!S[i].road) continue;
      for (let j = i + 1; j < S.length; j += 3) {
        if (!S[j].road) continue;
        let ds = Math.abs(S[j].s - S[i].s);
        if (track.closed) ds = Math.min(ds, track.length - ds);
        if (ds < 45) continue;
        const dx = S[i].p.x - S[j].p.x, dz = S[i].p.z - S[j].p.z;
        const lim = S[i].hw + S[j].hw + 3;
        if (dx * dx + dz * dz > lim * lim) continue;
        if (Math.abs(S[i].p.y - S[j].p.y) < 6.5 && S[i].kind !== 'LOOP' && S[j].kind !== 'LOOP') { clash = [S[i].piece, S[j].piece]; marks.push(S[i].p.clone()); break; }
      }
    }
    if (clash) {
      const name = (k) => (k >= n ? 'the closing section' : `piece ${k + 1}`);
      errors.push(`The road runs into itself (${name(clash[0])} and ${name(clash[1])}). Move one, or raise it with a hill to make a bridge.`);
    }
    if (track.closed && track.closure && track.closure.dist > 1) warnings.push({ text: 'The circuit does not quite close - check the last pieces.', piece: n - 1 });
  }
  return { track, errors, warnings, marks };
}

function pieceFromStringSafe(s) { try { return pieceFromString(s); } catch { return null; } }

// The definition the builder and the race get: circuits gain their closing
// section (written precisely).
export function buildDef(def) {
  if (def._built || def.blocks) return def._built ? def : { ...def, _built: true };
  const out = { ...def, _built: true };
  if (def.laps > 0) out.pieces = def.pieces.concat(closingStrings(def));
  return out;
}

// ---- library (this browser) -------------------------------------------------------
const KEY = 'customTracks';

export function library() {
  const list = load(KEY, []);
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const d of list) {
    try { out.push({ ...sanitize(d), slot: typeof d.slot === 'string' ? d.slot : undefined, updated: +d.updated || 0 }); } catch { /* skip broken entries */ }
  }
  return out.sort((a, b) => b.updated - a.updated);
}

// Save (insert or replace by slot). Each library entry keeps a stable slot id
// even as its content (and so its content id) changes.
export function saveToLibrary(def) {
  const list = library();
  const slot = def.slot || 's' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  const entry = { ...shareable(def), slot, updated: Date.now() };
  const i = list.findIndex((d) => d.slot === slot);
  const stored = list.map((d) => ({ ...shareable(d), slot: d.slot, updated: d.updated }));
  if (i >= 0) stored[i] = entry; else stored.unshift(entry);
  save(KEY, stored);
  return { ...sanitize(entry), slot, updated: entry.updated };
}

export function deleteFromLibrary(slot) {
  save(KEY, library().filter((d) => d.slot !== slot).map((d) => ({ ...shareable(d), slot: d.slot, updated: d.updated })));
}


// ---- sharing ---------------------------------------------------------------------
// Share code: "PT1." + base64url(deflate(json)); falls back to plain base64url
// ("PT0.") where CompressionStream is missing.
export async function encodeShare(def) {
  const json = JSON.stringify(shareable(def));
  const bytes = new TextEncoder().encode(json);
  if (typeof CompressionStream === 'function') {
    const z = await streamBytes(bytes, new CompressionStream('deflate-raw'));
    return 'PT1.' + b64url(z);
  }
  return 'PT0.' + b64url(bytes);
}

export async function decodeShare(text) {
  const s = String(text || '').trim();
  let json;
  if (s.startsWith('{')) json = s; // a pasted file
  else {
    const m = /^PT([01])\.([A-Za-z0-9_-]+)$/.exec(s.replace(/\s+/g, ''));
    if (!m) throw new Error('That is not a PolyTrack track code.');
    if (m[2].length > 40000) throw new Error('That code is too long.');
    let bytes = unb64url(m[2]);
    if (m[1] === '1') {
      if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot read compressed track codes.');
      bytes = await streamBytes(bytes, new DecompressionStream('deflate-raw'), 200000);
    }
    json = new TextDecoder().decode(bytes);
  }
  if (json.length > 200000) throw new Error('That track is too big.');
  let raw;
  try { raw = JSON.parse(json); } catch { throw new Error('The track data is damaged.'); }
  return sanitize(raw);
}

async function streamBytes(bytes, stream, max = Infinity) {
  const w = stream.writable.getWriter();
  // a damaged code makes these reject too; the read below reports it
  w.write(bytes).catch(() => {});
  w.close().catch(() => {});
  const chunks = [];
  let n = 0;
  const r = stream.readable.getReader();
  for (;;) {
    let step;
    try { step = await r.read(); } catch { throw new Error('The track code is damaged.'); }
    const { value, done } = step;
    if (done) break;
    n += value.length;
    if (n > max) throw new Error('That track is too big.');
    chunks.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

function b64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s) {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  let bin;
  try { bin = atob(b + '==='.slice((b.length + 3) % 4)); } catch { throw new Error('The track code is damaged.'); }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// the part of a definition worth sending to someone else
export function shareable(def) {
  if (def.blocks) {
    const out = { name: def.name, author: def.author, theme: def.theme, laps: def.laps || 3, difficulty: def.difficulty, blocks: def.blocks.map((a) => a.slice()) };
    if (def.medals) out.medals = { ...def.medals };
    if (!out.author) delete out.author;
    return out;
  }
  const out = { name: def.name, author: def.author, theme: def.theme, laps: def.laps, width: def.width, walls: def.walls, difficulty: def.difficulty, pieces: def.pieces.slice(0, LIMITS.pieces) };
  if (def._built && def.laps > 0) out.pieces = def.pieces.slice(0, def.pieces.length - closingCount(def));
  if (def.medals) out.medals = { ...def.medals };
  if (!out.author) delete out.author;
  return out;
}

// how many closing pieces a built definition carries (they're the precise ones)
function closingCount(def) {
  let n = 0;
  for (let i = def.pieces.length - 1; i >= 0 && /^(S \d+\.\d{3}|[LR] \d+\.\d{4} )/.test(def.pieces[i]); i--) n++;
  return n;
}

// file name for a download
export function fileName(def) {
  return (def.name || 'track').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '.polytrack.json';
}
