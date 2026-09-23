// Turns a track definition (a list of piece strings) into a finely sampled
// centreline with a full road frame at every sample. Everything downstream -
// road meshes, collision, checkpoints, AI racing line, minimap - reads these
// samples, so this module has no rendering dependencies and runs in Node.
//
// Piece grammar (one string per piece, first word is the type):
//   S 40            straight, 40 m
//   L 90 / R 45     left / right turn by degrees       r30 radius, b12 bank
//   K 12            kicker ramp that ends in a lip      a14 lip angle
//   J 20            jump gap - no road                  d3 land 3 m lower
//   LOOP            vertical loop                       r11 radius, o18 lateral shift (+ right)
// Modifiers on any piece:
//   u6 / d6         rise / fall 6 m across the piece (heights blend smoothly)
//   w12             road width at the end of the piece
//   cp              checkpoint gate at the end of the piece
//   boost           boost pad in the middle of the piece
//   wall / nowall / wallL / wallR   barrier override
//   ice dirt sand grass             surface
//   tunnel          decorative tunnel over the piece
import { Vector3 } from 'three';
import { DEG, clamp, lerp, smoothstep } from '../util/math.js';

export const SURF = { asphalt: 0, line: 1, dirt: 2, ice: 3, grass: 4, sand: 5, wall: 6, boost: 7, kill: 8, structure: 9 };
export const SURF_NAMES = Object.keys(SURF);

const STEP = 1.0;

export function parsePiece(str, def) {
  const tok = str.trim().split(/\s+/);
  const head = tok[0].toUpperCase();
  const p = {
    src: str, type: 'S', len: 0, turn: 0, radius: def.radius ?? 40, bank: 0, dh: null,
    width: null, cp: false, boost: false, walls: null, surface: null, tunnel: false,
    lip: 13, offset: null, loopR: 11,
  };
  let i = 1;
  const num = () => {
    const v = parseFloat(tok[i]);
    if (!isFinite(v)) throw new Error(`track ${def.id}: piece "${str}" is missing a number`);
    i++;
    return v;
  };
  if (head === 'S') { p.type = 'S'; if (tok[1] === '?') { p.auto = true; p.len = 0; i++; } else p.len = num(); }
  else if (head === 'L' || head === 'R') { p.type = 'T'; p.turn = num() * DEG * (head === 'L' ? 1 : -1); }
  else if (head === 'J') { p.type = 'J'; p.len = num(); }
  else if (head === 'K') { p.type = 'K'; p.len = num(); }
  else if (head === 'LOOP') { p.type = 'LOOP'; }
  else throw new Error(`track ${def.id}: unknown piece "${str}"`);
  for (; i < tok.length; i++) {
    const t = tok[i];
    let m;
    if ((m = /^r(\d+(?:\.\d+)?)$/.exec(t))) { if (p.type === 'LOOP') p.loopR = +m[1]; else p.radius = +m[1]; }
    else if ((m = /^b(-?\d+(?:\.\d+)?)$/.exec(t))) p.bank = +m[1];
    else if ((m = /^u(\d+(?:\.\d+)?)$/.exec(t))) p.dh = +m[1];
    else if ((m = /^d(\d+(?:\.\d+)?)$/.exec(t))) p.dh = -m[1];
    else if ((m = /^w(\d+(?:\.\d+)?)$/.exec(t))) p.width = +m[1];
    else if ((m = /^a(\d+(?:\.\d+)?)$/.exec(t))) p.lip = +m[1];
    else if ((m = /^o(-?\d+(?:\.\d+)?)$/.exec(t))) p.offset = +m[1];
    else if (t === 'cp') p.cp = true;
    else if (t === 'boost') p.boost = true;
    else if (t === 'wall') p.walls = 'both';
    else if (t === 'nowall') p.walls = 'none';
    else if (t === 'wallL') p.walls = 'left';
    else if (t === 'wallR') p.walls = 'right';
    else if (t === 'tunnel') p.tunnel = true;
    else if (t in SURF && t !== 'wall') p.surface = t;
    else throw new Error(`track ${def.id}: unknown modifier "${t}" in "${str}"`);
  }
  if (p.type === 'T') p.len = Math.abs(p.turn) * p.radius;
  if (p.type === 'K' && p.dh == null) p.dh = (p.len * Math.tan(p.lip * DEG)) / 2;
  if (p.dh == null) p.dh = 0;
  return p;
}

const fwdOf = (yaw, out = new Vector3()) => out.set(Math.sin(yaw), 0, Math.cos(yaw));
const leftOf = (yaw, out = new Vector3()) => out.set(Math.cos(yaw), 0, -Math.sin(yaw));

// Cubic Hermite on [0,1] with tangents already scaled by the interval length.
function hermite(h0, m0, h1, m1, u) {
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * h0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * h1 + (u3 - u2) * m1;
}
function hermiteD(h0, m0, h1, m1, u) {
  const u2 = u * u;
  return (6 * u2 - 6 * u) * h0 + (3 * u2 - 4 * u + 1) * m0 + (-6 * u2 + 6 * u) * h1 + (3 * u2 - 2 * u) * m1;
}

export function buildTrack(def) {
  const closed = (def.laps ?? 0) > 0;
  const pieces = def.pieces.map((s) => parsePiece(s, def));
  const N = pieces.length;
  if (closed) solveClosure(def, pieces);
  const baseWidth = def.width ?? 14;
  const wallMode = def.walls ?? 'turns';

  // ---- boundary heights -------------------------------------------------
  const H = new Array(N + 1);
  H[0] = def.startHeight ?? 0.25;
  for (let k = 0; k < N; k++) H[k + 1] = H[k] + pieces[k].dh;

  // ---- boundary grades (dh per horizontal metre) ------------------------
  // PCHIP-style: consecutive climbs blend into one ramp, peaks and valleys flatten.
  const slope = (p) => (p.len > 0 ? p.dh / p.len : 0);
  const G = new Array(N + 1).fill(0);
  for (let k = 0; k <= N; k++) {
    const a = k > 0 ? pieces[k - 1] : closed ? pieces[N - 1] : null;
    const b = k < N ? pieces[k] : closed ? pieces[0] : null;
    if (!a || !b) { G[k] = 0; continue; }
    if (a.type === 'LOOP' || b.type === 'LOOP') { G[k] = 0; continue; }
    if (a.type === 'K') { G[k] = Math.tan(a.lip * DEG); continue; }
    if (b.type === 'K') { G[k] = 0; continue; } // kickers start flat
    const ma = slope(a), mb = slope(b);
    G[k] = ma * mb <= 0 ? 0 : (2 * ma * mb) / (ma + mb);
  }
  // Jump gaps: take-off keeps the lip's grade, landing mirrors the parabola the
  // car flies when it clears the gap exactly at its design speed.
  for (let k = 0; k < N; k++) {
    if (pieces[k].type !== 'J') continue;
    const gIn = k > 0 && pieces[k - 1].type === 'K' ? Math.tan(pieces[k - 1].lip * DEG) : G[k];
    G[k] = gIn;
    const land = clamp(2 * slope(pieces[k]) - gIn, -0.7, 0);
    G[k + 1] = land;
  }

  // ---- boundary banks and widths -----------------------------------------
  const signedBank = (p) => (p.type === 'T' ? -Math.sign(p.turn) * p.bank : p.bank) * DEG;
  const B = new Array(N + 1).fill(0);
  for (let k = 0; k <= N; k++) {
    const a = k > 0 ? pieces[k - 1] : closed ? pieces[N - 1] : null;
    const b = k < N ? pieces[k] : closed ? pieces[0] : null;
    if (a && b && signedBank(a) !== 0 && Math.abs(signedBank(a) - signedBank(b)) < 1e-6) B[k] = signedBank(a);
  }
  const W = new Array(N + 1);
  W[0] = baseWidth;
  for (let k = 0; k < N; k++) W[k + 1] = pieces[k].width ?? W[k];
  if (closed && Math.abs(W[N] - W[0]) > 1e-6) W[0] = W[N];

  // ---- sample every piece ------------------------------------------------
  const samples = [];
  const pos = new Vector3(0, H[0], 0);
  let yaw = def.startYaw ?? 0;
  const fw = new Vector3(), lf = new Vector3();

  const wallsFor = (p) => {
    const m = p.walls ?? (p.type === 'LOOP' || p.tunnel ? 'both' : null);
    if (m === 'both') return [true, true];
    if (m === 'none') return [false, false];
    if (m === 'left') return [true, false];
    if (m === 'right') return [false, true];
    if (wallMode === 'all') return [true, true];
    if (wallMode === 'none') return [false, false];
    // 'turns': barrier on the outside of every corner
    if (p.type === 'T') return p.turn > 0 ? [false, true] : [true, false];
    return [false, false];
  };

  for (let k = 0; k < N; k++) {
    const p = pieces[k];
    const [wl, wr] = wallsFor(p);
    const surf = SURF[p.surface ?? def.surface ?? 'asphalt'];
    const startPos = pos.clone();
    const yaw0 = yaw;

    if (p.type === 'LOOP') {
      const R = p.loopR;
      const off = p.offset ?? W[k] + 4; // + shifts right
      fwdOf(yaw0, fw);
      leftOf(yaw0, lf);
      const right = lf.clone().multiplyScalar(-1);
      const n = Math.max(24, Math.ceil((Math.PI * 2 * R) / STEP));
      for (let j = 0; j < n; j++) {
        const u = j / n;
        const phi = u * Math.PI * 2;
        const lat = (off / (Math.PI * 2)) * (phi - Math.sin(phi));
        const P = startPos.clone()
          .addScaledVector(fw, R * Math.sin(phi))
          .addScaledVector(new Vector3(0, 1, 0), R * (1 - Math.cos(phi)))
          .addScaledVector(right, lat);
        const t = fw.clone().multiplyScalar(R * Math.cos(phi))
          .add(new Vector3(0, R * Math.sin(phi), 0))
          .addScaledVector(right, (off / (Math.PI * 2)) * (1 - Math.cos(phi)))
          .normalize();
        const nn = fw.clone().multiplyScalar(-Math.sin(phi)).add(new Vector3(0, Math.cos(phi), 0));
        nn.addScaledVector(t, -nn.dot(t)).normalize();
        const l = new Vector3().crossVectors(nn, t).normalize();
        samples.push(mkSample(P, t, nn, l, lerp(W[k], W[k + 1], u) / 2, true, surf, true, true, false, k, u, 0, 'LOOP', p.tunnel));
      }
      pos.copy(startPos).addScaledVector(right, off);
      continue;
    }

    const L = p.len;
    const n = Math.max(1, Math.ceil(L / STEP));
    const m0 = G[k] * L, m1 = G[k + 1] * L;
    const pb = signedBank(p);
    for (let j = 0; j < n; j++) {
      const u = j / n;
      const d = u * L;
      // horizontal position + heading
      let hx, hz, hy;
      if (p.type === 'T') {
        const th = p.turn * u;
        const sg = Math.sign(p.turn);
        leftOf(yaw0, lf);
        const l1 = leftOf(yaw0 + th, new Vector3());
        hx = startPos.x + sg * p.radius * (lf.x - l1.x);
        hz = startPos.z + sg * p.radius * (lf.z - l1.z);
        hy = yaw0 + th;
      } else {
        fwdOf(yaw0, fw);
        hx = startPos.x + fw.x * d;
        hz = startPos.z + fw.z * d;
        hy = yaw0;
      }
      const y = hermite(H[k], m0, H[k + 1], m1, u);
      const grade = L > 0 ? hermiteD(H[k], m0, H[k + 1], m1, u) / L : 0;
      // bank profile: ease from boundary bank to piece bank and back out
      let bank;
      if (pb === 0) bank = lerp(B[k], B[k + 1], smoothstep(0, 1, u));
      else {
        const inT = smoothstep(0, 0.3, u), outT = smoothstep(0.7, 1, u);
        bank = lerp(lerp(B[k], pb, inT), B[k + 1], outT);
      }
      const width = lerp(W[k], W[k + 1], smoothstep(0, 1, u));
      const P = new Vector3(hx, y, hz);
      const f = fwdOf(hy, new Vector3());
      const t = new Vector3(f.x, grade, f.z).normalize();
      const l0 = leftOf(hy, new Vector3());
      const n0 = new Vector3().crossVectors(t, l0).normalize();
      const cb = Math.cos(bank), sb = Math.sin(bank);
      const nn = n0.clone().multiplyScalar(cb).addScaledVector(l0, -sb);
      const l = l0.clone().multiplyScalar(cb).addScaledVector(n0, sb);
      const road = p.type !== 'J';
      const boost = p.boost && u >= 0.35 && u < 0.65;
      samples.push(mkSample(P, t, nn, l, width / 2, road, surf, wl, wr, boost, k, u, bank, p.type, p.tunnel));
    }
    // advance turtle to the end of the piece
    if (p.type === 'T') {
      const sg = Math.sign(p.turn);
      leftOf(yaw0, lf);
      const l1 = leftOf(yaw0 + p.turn, new Vector3());
      pos.set(startPos.x + sg * p.radius * (lf.x - l1.x), H[k + 1], startPos.z + sg * p.radius * (lf.z - l1.z));
      yaw = yaw0 + p.turn;
    } else {
      fwdOf(yaw0, fw);
      pos.set(startPos.x + fw.x * L, H[k + 1], startPos.z + fw.z * L);
    }
  }

  // closing sample / closure correction
  let closure = null;
  if (closed) {
    const s0 = samples[0];
    const err = new Vector3().subVectors(pos, s0.p);
    let yawErr = (yaw - (def.startYaw ?? 0)) % (Math.PI * 2);
    if (yawErr > Math.PI) yawErr -= Math.PI * 2;
    if (yawErr < -Math.PI) yawErr += Math.PI * 2;
    closure = { dist: err.length(), dx: err.x, dy: err.y, dz: err.z, yawDeg: yawErr / DEG };
    // spread a small residual along the lap so the seam is invisible
    const total = samples.length;
    for (let i = 0; i < total; i++) samples[i].p.addScaledVector(err, -i / total);
  } else {
    // final sample at the end of the last piece
    const last = pieces[N - 1];
    const lastS = samples[samples.length - 1];
    const [wl, wr] = wallsFor(last);
    samples.push(mkSample(pos.clone(), lastS.t.clone(), lastS.n.clone(), lastS.l.clone(), W[N] / 2, true,
      lastS.surf, wl, wr, false, N - 1, 1, 0, last.type, false));
  }

  // never let the road dip below ground level: lift the whole course instead
  let lowest = Infinity;
  for (const sm of samples) if (sm.road) lowest = Math.min(lowest, sm.p.y);
  const lift = (def.minHeight ?? 0.25) - lowest;
  if (lift > 1e-6) for (const sm of samples) sm.p.y += lift;

  // cumulative 3D distance
  let s = 0;
  for (let i = 0; i < samples.length; i++) {
    if (i > 0) s += samples[i].p.distanceTo(samples[i - 1].p);
    samples[i].s = s;
    samples[i].i = i;
  }
  const length = closed ? s + samples[samples.length - 1].p.distanceTo(samples[0].p) : s;

  // piece -> first sample index
  const pieceStart = new Array(N + 1).fill(-1);
  for (let i = samples.length - 1; i >= 0; i--) pieceStart[samples[i].piece] = i;
  pieceStart[N] = closed ? samples.length : samples.length - 1;

  // ---- checkpoints -------------------------------------------------------
  const startOffset = def.startOffset ?? 36;
  const startIndex = nearestIndexAtS(samples, startOffset);
  const checkpoints = [];
  for (let k = 0; k < N; k++) {
    if (!pieces[k].cp) continue;
    let idx = pieceStart[k + 1];
    if (idx >= samples.length) idx = 0;
    checkpoints.push(gateFrom(samples[idx]));
  }
  const start = gateFrom(samples[startIndex]);
  const finish = closed ? start : gateFrom(samples[samples.length - 1]);

  // ---- bounds --------------------------------------------------------------
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const sm of samples) {
    const r = sm.hw + 2;
    bounds.minX = Math.min(bounds.minX, sm.p.x - r); bounds.maxX = Math.max(bounds.maxX, sm.p.x + r);
    bounds.minZ = Math.min(bounds.minZ, sm.p.z - r); bounds.maxZ = Math.max(bounds.maxZ, sm.p.z + r);
    bounds.minY = Math.min(bounds.minY, sm.p.y); bounds.maxY = Math.max(bounds.maxY, sm.p.y);
  }

  return {
    def, pieces, samples, closed, length, laps: def.laps ?? 0,
    checkpoints, start, finish, startIndex, pieceStart, bounds, closure,
  };
}

// Circuits may leave up to two straights as "S ?"; solve their lengths so the
// lap returns exactly to the start. Headings don't depend on lengths, so this
// is a 2x2 linear system in the unknown lengths.
function solveClosure(def, pieces) {
  let yaw = def.startYaw ?? 0;
  let x = 0, z = 0;
  const unknown = [];
  for (const p of pieces) {
    if (p.type === 'T') {
      const sg = Math.sign(p.turn);
      const l0 = leftOf(yaw, new Vector3()), l1 = leftOf(yaw + p.turn, new Vector3());
      x += sg * p.radius * (l0.x - l1.x); z += sg * p.radius * (l0.z - l1.z);
      yaw += p.turn;
    } else if (p.type === 'LOOP') {
      const l = leftOf(yaw, new Vector3());
      const off = p.offset ?? (def.width ?? 14) + 4;
      x -= l.x * off; z -= l.z * off;
    } else if (p.auto) {
      unknown.push({ p, fx: Math.sin(yaw), fz: Math.cos(yaw) });
    } else {
      x += Math.sin(yaw) * p.len; z += Math.cos(yaw) * p.len;
    }
  }
  const turned = (yaw - (def.startYaw ?? 0)) / DEG;
  const rev = turned / 360;
  if (Math.abs(rev - Math.round(rev)) > 0.0001) throw new Error(`track ${def.id}: circuit turns ${turned.toFixed(1)} deg, needs a multiple of 360`);
  if (!unknown.length) return;
  if (unknown.length !== 2) throw new Error(`track ${def.id}: use exactly two 'S ?' pieces to auto-close`);
  const [a, b] = unknown;
  // a.len * fa + b.len * fb = -(x, z)
  const det = a.fx * b.fz - a.fz * b.fx;
  if (Math.abs(det) < 1e-6) throw new Error(`track ${def.id}: the two 'S ?' pieces are parallel`);
  const la = (-x * b.fz + z * b.fx) / det;
  const lb = (-z * a.fx + x * a.fz) / det;
  if (la < 4 || lb < 4) throw new Error(`track ${def.id}: closing straights would be ${la.toFixed(1)} m and ${lb.toFixed(1)} m`);
  a.p.len = la; b.p.len = lb;
}

function mkSample(p, t, n, l, hw, road, surf, wallL, wallR, boost, piece, u, bank, kind, tunnel) {
  return { p, t, n, l, hw, road, surf, wallL, wallR, boost, piece, u, bank, kind, tunnel, s: 0, i: 0 };
}

function gateFrom(sm) {
  return { index: sm.i, s: sm.s, p: sm.p.clone(), t: sm.t.clone(), n: sm.n.clone(), l: sm.l.clone(), hw: sm.hw };
}

export function nearestIndexAtS(samples, s) {
  let lo = 0, hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].s < s) lo = mid + 1; else hi = mid;
  }
  return lo;
}
