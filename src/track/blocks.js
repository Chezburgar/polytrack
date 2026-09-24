// Block tracks: the 3D track builder places blocks on a grid (20 m squares,
// 4 m height steps). A block is a piece of road with two ends; the route runs
// from the start block, through every block whose ends meet, to a finish block
// (a sprint) or back to the start (a circuit). A ramp followed by empty squares
// becomes a jump to the next road ahead. The route is turned into the same
// piece strings the built-in tracks use (see builder.js), so racing, the AI,
// checkpoints and everything else work on block tracks unchanged.
//
// Grid frame, as in the builder: +z is yaw 0, +x is on your LEFT when facing
// +z. Directions: 0 = +z, 1 = +x, 2 = -z, 3 = -x; a left turn adds 1.
// A block's own frame: its anchor square is (0,0); end 0 is the middle of the
// anchor's back edge (z = -0.5) at height 0, and the road runs toward +z.

export const TILE = 20;
export const LAYER = 4;
export const BASE_H = 0.25; // road surface height at layer 0
export const LIMITS = { blocks: 800, span: 60, top: 24, route: 500, gap: 8 };

const cells = (x0, x1, z0, z1, y0, y1) => {
  const out = [];
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) out.push([x, y, z]);
  return out;
};
const r = (n) => (n - 0.5) * TILE; // radius of a 90 degree turn filling n x n squares

// ends: [x, z, y, dir] in the block's frame (dir points out of the block).
// pieces: the road driven from end 0 to end 1. sym: the same pieces both ways.
// oneway: only drivable from end 0. gate: which gate the preview draws.
export const BLOCKS = {
  road: { name: 'Straight', cat: 'road', ends: [[0, -0.5, 0, 2], [0, 0.5, 0, 0]], cells: cells(0, 0, 0, 0, 0, 1), pieces: ['S 20'], sym: true },
  road2: { name: 'Long straight', cat: 'road', ends: [[0, -0.5, 0, 2], [0, 2.5, 0, 0]], cells: cells(0, 0, 0, 2, 0, 1), pieces: ['S 60'], sym: true },
  turn1: { name: 'Hairpin', cat: 'turn', ends: [[0, -0.5, 0, 2], [0.5, 0, 0, 1]], cells: cells(0, 0, 0, 0, 0, 1), pieces: [`L 90 r${r(1)}`] },
  turn2: { name: 'Turn', cat: 'turn', ends: [[0, -0.5, 0, 2], [1.5, 1, 0, 1]], cells: cells(0, 1, 0, 1, 0, 1), pieces: [`L 90 r${r(2)}`] },
  turn3: { name: 'Wide turn', cat: 'turn', ends: [[0, -0.5, 0, 2], [2.5, 2, 0, 1]], cells: cells(0, 2, 0, 2, 0, 1), pieces: [`L 90 r${r(3)}`] },
  turn4: { name: 'Sweeper', cat: 'turn', ends: [[0, -0.5, 0, 2], [3.5, 3, 0, 1]], cells: cells(0, 3, 0, 3, 0, 1), pieces: [`L 90 r${r(4)}`] },
  sbendR: { name: 'S-bend right', cat: 'turn', ends: [[0, -0.5, 0, 2], [-1, 1.5, 0, 0]], cells: cells(-1, 0, 0, 1, 0, 1), pieces: ['R 53.1301 r25', 'L 53.1301 r25'] },
  sbendL: { name: 'S-bend left', cat: 'turn', ends: [[0, -0.5, 0, 2], [1, 1.5, 0, 0]], cells: cells(0, 1, 0, 1, 0, 1), pieces: ['L 53.1301 r25', 'R 53.1301 r25'] },
  up: { name: 'Slope up', cat: 'height', ends: [[0, -0.5, 0, 2], [0, 1.5, 1, 0]], cells: cells(0, 0, 0, 1, 0, 2), pieces: [`S 40 u${LAYER}`] },
  down: { name: 'Slope down', cat: 'height', ends: [[0, -0.5, 0, 2], [0, 1.5, -1, 0]], cells: cells(0, 0, 0, 1, -1, 1), pieces: [`S 40 d${LAYER}`] },
  steepUp: { name: 'Steep up', cat: 'height', ends: [[0, -0.5, 0, 2], [0, 0.5, 1, 0]], cells: cells(0, 0, 0, 0, 0, 2), pieces: [`S 20 u${LAYER}`] },
  steepDown: { name: 'Steep down', cat: 'height', ends: [[0, -0.5, 0, 2], [0, 0.5, -1, 0]], cells: cells(0, 0, 0, 0, -1, 1), pieces: [`S 20 d${LAYER}`] },
  climb: { name: 'Big climb', cat: 'height', ends: [[0, -0.5, 0, 2], [0, 2.5, 2, 0]], cells: cells(0, 0, 0, 2, 0, 3), pieces: [`S 60 u${2 * LAYER}`] },
  drop: { name: 'Big drop', cat: 'height', ends: [[0, -0.5, 0, 2], [0, 2.5, -2, 0]], cells: cells(0, 0, 0, 2, -2, 1), pieces: [`S 60 d${2 * LAYER}`] },
  ramp: { name: 'Ramp', cat: 'stunt', ends: [[0, -0.5, 0, 2], [0, 0.5, 0, 0]], cells: cells(0, 0, 0, 0, 0, 1), pieces: ['S 8', 'K 12 a12'], oneway: true, kicker: true },
  bigRamp: { name: 'Big ramp', cat: 'stunt', ends: [[0, -0.5, 0, 2], [0, 1.5, 0, 0]], cells: cells(0, 0, 0, 1, 0, 1), pieces: ['S 16', 'K 24 a16'], oneway: true, kicker: true },
  loopR: { name: 'Loop', cat: 'stunt', ends: [[0, -0.5, 0, 2], [-1, 1.5, 0, 0]], cells: cells(-1, 0, 0, 1, 0, 6), pieces: ['S 20', 'LOOP r12 o20', 'S 20'] },
  loopL: { name: 'Loop (left)', cat: 'stunt', ends: [[0, -0.5, 0, 2], [1, 1.5, 0, 0]], cells: cells(0, 1, 0, 1, 0, 6), pieces: ['S 20', 'LOOP r12 o-20', 'S 20'] },
  boost: { name: 'Boost pad', cat: 'special', ends: [[0, -0.5, 0, 2], [0, 0.5, 0, 0]], cells: cells(0, 0, 0, 0, 0, 1), pieces: ['S 20 boost'], sym: true },
  start: { name: 'Start', cat: 'special', ends: [[0, -0.5, 0, 2], [0, 1.5, 0, 0]], cells: cells(0, 0, 0, 1, 0, 1), pieces: ['S 40'], oneway: true, gate: 'start' },
  cp: { name: 'Checkpoint', cat: 'special', ends: [[0, -0.5, 0, 2], [0, 0.5, 0, 0]], cells: cells(0, 0, 0, 0, 0, 1), pieces: ['S 10 cp', 'S 10'], sym: true, gate: 'cp' },
  finish: { name: 'Finish', cat: 'special', ends: [[0, -0.5, 0, 2], [0, 0.5, 0, 0]], cells: cells(0, 0, 0, 0, 0, 1), pieces: ['S 10', 'S 10'], sym: true, gate: 'finish' },
};
export const BLOCK_IDS = Object.keys(BLOCKS);
export const CATS = [['road', 'Road'], ['turn', 'Turns'], ['height', 'Height'], ['stunt', 'Stunts'], ['special', 'Special']];
export const SURFACES = ['asphalt', 'dirt', 'ice', 'sand', 'grass'];
export const WALLS = ['auto', 'both', 'left', 'right', 'none'];
export const BANKS = [0, 5, 10, 15, 20];

// ---- frames ----------------------------------------------------------------------
// block-frame (x, z) -> grid, for a block at (bx, bz) turned rot quarter turns left
export function toWorld(b, x, z) {
  switch (b.r & 3) {
    case 0: return [b.x + x, b.z + z];
    case 1: return [b.x + z, b.z - x];
    case 2: return [b.x - x, b.z - z];
    default: return [b.x - z, b.z + x];
  }
}
export const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]]; // dir -> (dx, dz)

export function blockEnds(b) {
  const def = BLOCKS[b.t];
  return def.ends.map(([x, z, y, d]) => {
    const [wx, wz] = toWorld(b, x, z);
    return { x: wx, z: wz, y: b.y + y, dir: (d + b.r) & 3 };
  });
}

export function blockCells(b) {
  return BLOCKS[b.t].cells.map(([x, y, z]) => { const [wx, wz] = toWorld(b, x, z); return [wx, b.y + y, wz]; });
}

const endKey = (x, z, y) => `${Math.round(x * 2)},${Math.round(z * 2)},${y}`;
export const cellKey = (x, y, z) => `${x},${y},${z}`;

// Occupancy map (cell -> block index) plus whether a block fits.
export function occupancy(blocks) {
  const m = new Map();
  blocks.forEach((b, i) => { for (const [x, y, z] of blockCells(b)) m.set(cellKey(x, y, z), i); });
  return m;
}

export function fits(b, occ, ignore = -1) {
  const L = LIMITS;
  for (const [x, y, z] of blockCells(b)) {
    if (y < 0 || y > L.top + 7 || Math.abs(x) > L.span || Math.abs(z) > L.span) return false;
    const o = occ.get(cellKey(x, y, z));
    if (o != null && o !== ignore) return false;
  }
  for (const e of blockEnds(b)) if (e.y < 0 || e.y > L.top) return false;
  return true;
}

// ---- pieces both ways -------------------------------------------------------------
const flip = (s) => s.replace(/^L /, '\u0001').replace(/^R /, 'L ').replace('\u0001', 'R ')
  .replace(/ u(\d)/, ' \u0002$1').replace(/ d(\d)/, ' u$1').replace('\u0002', 'd');

// dh of one piece string (metres), matching the builder
function pieceDh(s) {
  const m = / ([ud])(\d+(?:\.\d+)?)/.exec(s);
  if (/^K /.test(s)) {
    if (m) return (m[1] === 'u' ? 1 : -1) * +m[2];
    const len = +s.split(/\s+/)[1];
    const lip = +(/ a(\d+(?:\.\d+)?)/.exec(s)?.[1] ?? 13);
    return (len * Math.tan((lip * Math.PI) / 180)) / 2;
  }
  return m ? (m[1] === 'u' ? 1 : -1) * +m[2] : 0;
}

// the road of block b driven from end `from`, with its surface / walls / bank /
// tunnel options applied
export function blockPieces(b, from = 0) { return drive(b, from); }
function drive(b, from) {
  const def = BLOCKS[b.t];
  let list = def.pieces.slice();
  if (from === 1 && !def.sym) list = list.slice().reverse().map(flip);
  const p = b.p || {};
  const mods = [];
  if (p.surf && p.surf !== 'asphalt') mods.push(p.surf);
  if (p.tunnel) mods.push('tunnel');
  let walls = p.walls && p.walls !== 'auto' ? p.walls : null;
  if (walls && from === 1) walls = walls === 'left' ? 'right' : walls === 'right' ? 'left' : walls;
  if (walls) mods.push({ both: 'wall', none: 'nowall', left: 'wallL', right: 'wallR' }[walls]);
  return list.map((s) => {
    let o = s;
    if (p.bank && /^[LR] /.test(o)) o += ` b${p.bank}`;
    if (mods.length) o += ' ' + mods.join(' ');
    return o;
  });
}

// ---- the route -------------------------------------------------------------------------
// Follows the road from the start block. Returns
//   { ok, closed, pieces, route: [{ i, from, p0, p1 }], errors: [{ text, at }],
//     loose: [block indices not on the route], start, finishAt }
// `at` is a grid point {x, y, z} the editor can mark.
export function solveRoute(blocks) {
  const errors = [];
  const out = { ok: false, closed: false, pieces: [], route: [], errors, loose: [], start: null, finishAt: null };
  const starts = blocks.map((b, i) => (b.t === 'start' ? i : -1)).filter((i) => i >= 0);
  if (!starts.length) { errors.push({ text: 'Place a Start block - the race begins there.' }); out.loose = blocks.map((_, i) => i); return out; }
  if (starts.length > 1) errors.push({ text: 'There is more than one Start block - only the first one counts.', at: blocks[starts[1]] });
  // every block end, by grid point
  const ends = new Map();
  blocks.forEach((b, i) => blockEnds(b).forEach((e, k) => {
    const key = endKey(e.x, e.z, e.y);
    if (!ends.has(key)) ends.set(key, []);
    ends.get(key).push({ i, k, dir: e.dir });
  }));
  const si = starts[0];
  const s0 = blockEnds(blocks[si])[0];
  out.start = { x: s0.x, z: s0.z, y: s0.y, dir: (s0.dir + 2) & 3 };
  let h = BASE_H + s0.y * LAYER;
  const used = new Set();
  let cur = si, from = 0;
  for (let guard = 0; guard < LIMITS.route; guard++) {
    const b = blocks[cur];
    const def = BLOCKS[b.t];
    if (from === 1 && def.oneway) { errors.push({ text: `This ${def.name.toLowerCase()} is the wrong way round - rotate it (R).`, at: b }); break; }
    if (used.has(cur)) { errors.push({ text: 'The road runs through the same block twice.', at: b }); break; }
    used.add(cur);
    const pieces = drive(b, from);
    const p0 = out.pieces.length;
    for (const s of pieces) { out.pieces.push(s); h += pieceDh(s); }
    out.route.push({ i: cur, from, p0, p1: out.pieces.length });
    const e = blockEnds(b)[1 - from];
    if (b.t === 'finish') { out.finishAt = p0 + 1; out.ok = true; break; }
    // the block whose end meets this one, facing back at us
    const want = (e.dir + 2) & 3;
    const next = (ends.get(endKey(e.x, e.z, e.y)) || []).find((c) => c.i !== cur && c.dir === want);
    if (def.kicker) {
      if (next) { errors.push({ text: 'Leave a gap after a ramp - that is where you jump.', at: b }); break; }
      // a jump: the nearest road ahead at this height or lower
      const [dx, dz] = DIRS[e.dir];
      let land = null;
      for (let k = 1; k <= LIMITS.gap && !land; k++) {
        for (let y = e.y; y >= Math.max(0, e.y - 8) && !land; y--) {
          const c = (ends.get(endKey(e.x + dx * k, e.z + dz * k, y)) || []).find((q) => q.dir === want);
          if (c) land = { c, k, y };
        }
      }
      if (!land) { errors.push({ text: 'Nothing to land on after this ramp - put road ahead of it (the same height or lower).', at: b }); break; }
      const drop = h - (BASE_H + land.y * LAYER);
      out.pieces.push(`J ${land.k * TILE}${drop > 0.001 ? ` d${drop.toFixed(3)}` : ''}`);
      h -= drop;
      cur = land.c.i; from = land.c.k;
      if (cur === si) { if (from === 0) { out.closed = true; out.ok = true; } else errors.push({ text: 'The road comes back into the Start block the wrong way.', at: blocks[si] }); break; }
      continue;
    }
    if (!next) { errors.push({ text: 'The road ends here - add more road, a Finish, or bring it back to the Start.', at: { x: e.x, y: e.y, z: e.z } }); break; }
    if (next.i === si) {
      if (next.k === 0) { out.closed = true; out.ok = true; } else errors.push({ text: 'The road comes back into the Start block the wrong way.', at: blocks[si] });
      break;
    }
    cur = next.i; from = next.k;
  }
  if (!out.ok && !errors.length) errors.push({ text: 'The road is too long.' });
  out.loose = blocks.map((_, i) => i).filter((i) => !used.has(i));
  return out;
}

// Block ends that meet nothing (where the next block goes).
export function openEnds(blocks) {
  const ends = new Map();
  const all = [];
  blocks.forEach((b, i) => blockEnds(b).forEach((e, k) => {
    const key = endKey(e.x, e.z, e.y);
    all.push({ ...e, i, k, key });
    if (!ends.has(key)) ends.set(key, []);
    ends.get(key).push(e.dir);
  }));
  return all.filter((e) => !(ends.get(e.key) || []).includes((e.dir + 2) & 3));
}

// A block track as the builder wants it: the route's pieces placed at the
// Start block, so the built road lines up with the grid exactly.
export function routeDef(meta, blocks, route = solveRoute(blocks)) {
  const s = route.start;
  const def = {
    name: meta.name, theme: meta.theme, laps: route.closed ? Math.max(1, meta.laps || 3) : 0,
    width: 14, walls: 'turns', difficulty: meta.difficulty ?? 1,
    pieces: route.pieces, startOffset: 36,
    startX: s ? s.x * TILE : 0, startZ: s ? s.z * TILE : 0, startYaw: s ? (s.dir * Math.PI) / 2 : 0,
    startHeight: s ? BASE_H + s.y * LAYER : BASE_H,
  };
  if (!route.closed && route.finishAt != null) def.finishAt = route.finishAt;
  return def;
}

// ---- compact storage -----------------------------------------------------------------------
// block -> [type, x, y, z, rot, surf, walls, bank, tunnel] with trailing defaults dropped
export function packBlock(b) {
  const p = b.p || {};
  const a = [b.t, b.x, b.y, b.z, b.r & 3, SURFACES.indexOf(p.surf || 'asphalt'), WALLS.indexOf(p.walls || 'auto'), p.bank || 0, p.tunnel ? 1 : 0];
  while (a.length > 5 && !a[a.length - 1]) a.pop();
  return a;
}

// untrusted array -> block, or null
export function unpackBlock(a) {
  if (!Array.isArray(a) || a.length < 5 || a.length > 9) return null;
  const [t, x, y, z, rot, surf = 0, walls = 0, bank = 0, tunnel = 0] = a;
  if (typeof t !== 'string' || !BLOCKS[t]) return null;
  const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
  const bx = int(x, -LIMITS.span, LIMITS.span), by = int(y, 0, LIMITS.top), bz = int(z, -LIMITS.span, LIMITS.span), br = int(rot, 0, 3);
  if (bx == null || by == null || bz == null || br == null) return null;
  const b = { t, x: bx, y: by, z: bz, r: br };
  const p = {};
  if (SURFACES[surf] && surf) p.surf = SURFACES[surf];
  if (WALLS[walls] && walls) p.walls = WALLS[walls];
  if (BANKS.includes(bank) && bank) p.bank = bank;
  if (tunnel === 1) p.tunnel = true;
  if (Object.keys(p).length) b.p = p;
  return b;
}

// Place a block of type t so that its end k meets an open road end
// `open` = { x, z, y, dir } (dir: the way the road leaves). Entering a turn at
// end 0 turns left, at end 1 turns right.
export function attach(t, open, k = 0) {
  const [ex, ez, ey, ed] = BLOCKS[t].ends[k];
  const r = ((open.dir + 2) - ed) & 3;
  const [rx, rz] = toWorld({ x: 0, z: 0, r }, ex, ez);
  return { t, x: Math.round(open.x - rx), y: open.y - ey, z: Math.round(open.z - rz), r };
}

// Lay blocks one after another: seq items are a type, or [type, 'R'] for a
// right-hand turn. Returns the blocks.
export function walk(seq, open = { x: 0, z: -0.5, y: 0, dir: 0 }) {
  const out = [];
  for (const item of seq) {
    const [t, side] = Array.isArray(item) ? item : [item, 'L'];
    const k = side === 'R' ? 1 : 0;
    const b = attach(t, open, k);
    out.push(b);
    open = blockEnds(b)[1 - k];
  }
  return out;
}

// the starter layout for a new track: a small circuit with a checkpoint
export function templateBlocks() {
  return walk(['start', 'road', ['turn3', 'R'], 'road2', 'cp', ['turn3', 'R'], 'road2', ['turn3', 'R'], 'road2', 'road', ['turn3', 'R']]);
}
