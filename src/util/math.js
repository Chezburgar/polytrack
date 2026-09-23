// Small numeric helpers shared by the simulation (runs in Node too) and the client.
export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a);
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
// Frame-rate independent exponential approach.
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const wrapAngle = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
export const sign = (v) => (v < 0 ? -1 : 1);

// Deterministic PRNG: the same seed always builds the same scenery.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// 2D value noise + fBm for terrain. Seeded, allocation-free per call.
export function makeNoise2D(seed) {
  const rnd = mulberry32(seed);
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = rnd() * 2 - 1; }
  for (let i = 255; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  for (let i = 0; i < 256; i++) perm[256 + i] = perm[i];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const a = vals[perm[perm[X] + Y]], b = vals[perm[perm[X + 1] + Y]];
    const c = vals[perm[perm[X] + Y + 1]], d = vals[perm[perm[X + 1] + Y + 1]];
    const u = fade(xf), v = fade(yf);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  noise.fbm = (x, y, oct = 4, lac = 2.0, gain = 0.5) => {
    let amp = 1, f = 1, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += amp * noise(x * f, y * f);
      norm += amp;
      amp *= gain;
      f *= lac;
    }
    return sum / norm;
  };
  return noise;
}

export function formatTime(ms, { plus = false } = {}) {
  if (ms == null || !isFinite(ms)) return '--:--.---';
  const neg = ms < 0;
  ms = Math.abs(Math.round(ms));
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const str = `${m}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
  return neg ? '-' + str : plus ? '+' + str : str;
}

export function formatDelta(ms) {
  if (ms == null || !isFinite(ms)) return '';
  const neg = ms < 0;
  const a = Math.abs(Math.round(ms));
  const s = Math.floor(a / 1000);
  const r = a % 1000;
  return (neg ? '-' : '+') + `${s}.${String(r).padStart(3, '0')}`;
}
