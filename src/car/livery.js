// Livery atlas: one 1024x1024 canvas per car holding both sides, the top and
// the ends. The body builder maps each painted face into these regions, so
// stripes and numbers read correctly on both flanks.
//   left flank  y 0..320   (front of car at the LEFT edge)
//   right flank y 320..640 (front of car at the RIGHT edge)
//   top view    y 640..960 (front of car at the RIGHT edge, car's left side at the top)
//   ends        y 960..1024
import { clamp } from '../util/math.js';

export const ATLAS = 1024;
export const SIDE_H = 320;
export const HMAX = 1.45; // metres of body height mapped onto a flank region

export const LIVERIES = [
  { id: 'none', name: 'Solid' },
  { id: 'stripes', name: 'Twin Stripes' },
  { id: 'side', name: 'Side Stripe' },
  { id: 'twotone', name: 'Two-Tone' },
  { id: 'flames', name: 'Flames' },
  { id: 'checker', name: 'Checkered' },
  { id: 'bolt', name: 'Lightning' },
  { id: 'split', name: 'Split' },
  { id: 'fade', name: 'Fade' },
  { id: 'camo', name: 'Camo' },
  { id: 'wave', name: 'Wave' },
  { id: 'hex', name: 'Hex Grid' },
];

// ---- UV mapping helpers used by the body builder ---------------------------
export function sideUV(side, z, y, zF, zR) {
  const L = zF - zR;
  const u = side > 0 ? (zF - z) / L : (z - zR) / L;
  const top = side > 0 ? 0 : SIDE_H;
  const cy = top + SIDE_H - clamp(y / HMAX, 0, 1) * SIDE_H;
  return [clamp(u, 0, 1), 1 - cy / ATLAS];
}
export function topUV(x, z, zF, zR, halfW) {
  const u = (z - zR) / (zF - zR);
  const cy = 640 + (1 - (clamp(x / halfW, -1, 1) + 1) / 2) * SIDE_H;
  return [clamp(u, 0, 1), 1 - cy / ATLAS];
}
export function endUV(x, y, halfW) {
  const u = (clamp(x / halfW, -1, 1) + 1) / 2;
  const cy = 960 + 64 - clamp(y / HMAX, 0, 1) * 64;
  return [u, 1 - cy / ATLAS];
}

// ---- painter ----------------------------------------------------------------
export function paintLivery(canvas, c) {
  const ctx = canvas.getContext('2d');
  const W = ATLAS;
  const P = c.paint, A = c.accent, D = c.detail || '#15171c';
  ctx.save();
  ctx.fillStyle = P;
  ctx.fillRect(0, 0, W, W);
  const flank = (fn) => {
    // draw fn in "front at left" coordinates on the left flank, mirrored on the right
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, SIDE_H); ctx.clip(); fn(0); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(0, SIDE_H, W, SIDE_H); ctx.clip();
    ctx.translate(W, SIDE_H); ctx.scale(-1, 1); fn(0); ctx.restore();
  };
  const top = (fn) => { ctx.save(); ctx.beginPath(); ctx.rect(0, 640, W, SIDE_H); ctx.clip(); ctx.translate(0, 640); fn(); ctx.restore(); };
  const ends = (fn) => { ctx.save(); ctx.beginPath(); ctx.rect(0, 960, W, 64); ctx.clip(); ctx.translate(0, 960); fn(); ctx.restore(); };
  // body height (m) -> y inside a flank region
  const fy = (m) => SIDE_H - (m / HMAX) * SIDE_H;

  switch (c.livery) {
    case 'stripes': {
      top(() => {
        ctx.fillStyle = A;
        ctx.fillRect(0, 160 - 58, W, 38);
        ctx.fillRect(0, 160 + 20, W, 38);
      });
      ends(() => { ctx.fillStyle = A; ctx.fillRect(512 - 58, 0, 38, 64); ctx.fillRect(512 + 20, 0, 38, 64); });
      break;
    }
    case 'side': {
      flank(() => {
        ctx.fillStyle = A;
        ctx.beginPath();
        ctx.moveTo(40, fy(0.62)); ctx.lineTo(W, fy(0.7)); ctx.lineTo(W, fy(0.52)); ctx.lineTo(70, fy(0.47)); ctx.closePath(); ctx.fill();
        ctx.fillStyle = D;
        ctx.fillRect(0, fy(0.44), W, 6);
      });
      break;
    }
    case 'twotone': {
      flank(() => { ctx.fillStyle = A; ctx.fillRect(0, 0, W, fy(0.8)); });
      top(() => { ctx.fillStyle = A; ctx.fillRect(0, 0, W, SIDE_H); });
      break;
    }
    case 'flames': {
      flank(() => {
        const cols = [A, mix(A, '#ffffff', 0.35)];
        for (let layer = 0; layer < 2; layer++) {
          ctx.fillStyle = cols[layer];
          ctx.beginPath();
          const base = layer ? 0.52 : 0.46, amp = layer ? 0.1 : 0.16;
          ctx.moveTo(0, fy(base - amp));
          const n = 6;
          for (let i = 0; i < n; i++) {
            const x0 = (i / n) * W * (layer ? 0.55 : 0.75);
            const x1 = ((i + 1) / n) * W * (layer ? 0.55 : 0.75);
            const tip = x1 + 110 - i * 12;
            ctx.quadraticCurveTo(x0 + (x1 - x0) * 0.5, fy(base + amp * 1.2), tip, fy(base + amp * (0.4 - i * 0.05) + (i % 2 ? 0.05 : -0.05)));
            ctx.quadraticCurveTo(x1, fy(base), x1, fy(base - amp * 0.2));
          }
          ctx.lineTo(W * (layer ? 0.55 : 0.75), fy(base - amp));
          ctx.quadraticCurveTo(W * 0.3, fy(base - amp * 1.3), 0, fy(base - amp));
          ctx.closePath();
          ctx.fill();
        }
      });
      top(() => {
        ctx.fillStyle = A;
        ctx.beginPath();
        ctx.moveTo(W, 160 - 70); ctx.quadraticCurveTo(W * 0.8, 160 - 40, W * 0.66, 160 - 90);
        ctx.quadraticCurveTo(W * 0.72, 160, W * 0.6, 160); ctx.quadraticCurveTo(W * 0.72, 160, W * 0.66, 160 + 90);
        ctx.quadraticCurveTo(W * 0.8, 160 + 40, W, 160 + 70); ctx.closePath(); ctx.fill();
      });
      break;
    }
    case 'checker': {
      flank(() => {
        const s = 34;
        for (let y = fy(0.72); y < fy(0.3); y += s) for (let x = W * 0.55; x < W; x += s) {
          if ((Math.floor(x / s) + Math.floor(y / s)) % 2 === 0) { ctx.fillStyle = A; ctx.fillRect(x, y, s, s); }
        }
      });
      top(() => {
        const s = 40;
        for (let y = 0; y < SIDE_H; y += s) for (let x = 0; x < W * 0.22; x += s) {
          if ((Math.floor(x / s) + Math.floor(y / s)) % 2 === 0) { ctx.fillStyle = A; ctx.fillRect(x, y, s, s); }
        }
      });
      break;
    }
    case 'bolt': {
      flank(() => {
        ctx.fillStyle = A;
        ctx.beginPath();
        const pts = [[60, 0.62], [380, 0.66], [330, 0.5], [700, 0.58], [640, 0.42], [W, 0.52], [W, 0.44], [600, 0.33], [660, 0.47], [300, 0.4], [350, 0.55]];
        ctx.moveTo(pts[0][0], fy(pts[0][1]));
        for (const [x, y] of pts.slice(1)) ctx.lineTo(x, fy(y));
        ctx.closePath(); ctx.fill();
      });
      break;
    }
    case 'split': {
      flank(() => {
        ctx.fillStyle = A;
        ctx.beginPath(); ctx.moveTo(W * 0.45, 0); ctx.lineTo(W, 0); ctx.lineTo(W, SIDE_H); ctx.lineTo(W * 0.62, SIDE_H); ctx.closePath(); ctx.fill();
        ctx.fillStyle = D;
        ctx.beginPath(); ctx.moveTo(W * 0.43, 0); ctx.lineTo(W * 0.45, 0); ctx.lineTo(W * 0.62, SIDE_H); ctx.lineTo(W * 0.6, SIDE_H); ctx.closePath(); ctx.fill();
      });
      top(() => { ctx.fillStyle = A; ctx.fillRect(0, 0, W * 0.47, SIDE_H); });
      break;
    }
    case 'fade': {
      flank(() => {
        const g = ctx.createLinearGradient(W * 0.25, 0, W * 0.9, 0);
        g.addColorStop(0, rgba(A, 0)); g.addColorStop(1, rgba(A, 1));
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, SIDE_H);
      });
      top(() => {
        const g = ctx.createLinearGradient(W * 0.75, 0, W * 0.1, 0);
        g.addColorStop(0, rgba(A, 0)); g.addColorStop(1, rgba(A, 1));
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, SIDE_H);
      });
      break;
    }
    case 'camo': {
      const rnd = seeded(7);
      const blobs = (w, h) => {
        for (let i = 0; i < 70; i++) {
          ctx.fillStyle = [A, D, mix(P, A, 0.5)][i % 3];
          const x = rnd() * w, y = rnd() * h, r = 20 + rnd() * 48;
          ctx.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2 + rnd() * 0.5;
            const rr = r * (0.6 + rnd() * 0.6);
            ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
          }
          ctx.closePath(); ctx.fill();
        }
      };
      flank(() => blobs(W, SIDE_H));
      top(() => blobs(W, SIDE_H));
      break;
    }
    case 'wave': {
      flank(() => {
        ctx.fillStyle = A;
        ctx.beginPath(); ctx.moveTo(0, SIDE_H);
        for (let x = 0; x <= W; x += 16) ctx.lineTo(x, fy(0.5 + Math.sin(x / 110) * 0.09));
        ctx.lineTo(W, SIDE_H); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = D; ctx.lineWidth = 7; ctx.beginPath();
        for (let x = 0; x <= W; x += 16) ctx.lineTo(x, fy(0.5 + Math.sin(x / 110) * 0.09) - 10);
        ctx.stroke();
      });
      break;
    }
    case 'hex': {
      const hexes = (w, h) => {
        ctx.strokeStyle = rgba(A, 0.95); ctx.lineWidth = 5;
        const r = 26;
        for (let row = 0; row * r * 1.5 < h + r; row++) for (let col = 0; col * r * 1.732 < w + r; col++) {
          const x = col * r * 1.732 + (row % 2 ? r * 0.866 : 0), y = row * r * 1.5;
          if ((col * 7 + row * 3) % 5 === 0) { ctx.fillStyle = rgba(A, 0.9); } else ctx.fillStyle = null;
          ctx.beginPath();
          for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + (k * Math.PI) / 3; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
          ctx.closePath();
          if (ctx.fillStyle && (col * 7 + row * 3) % 5 === 0) ctx.fill();
          ctx.stroke();
        }
      };
      flank(() => { ctx.save(); ctx.beginPath(); ctx.rect(W * 0.35, 0, W, SIDE_H); ctx.clip(); hexes(W, SIDE_H); ctx.restore(); });
      break;
    }
    default: break;
  }

  // race number roundel on both doors and the roof
  if (c.showNumber) {
    const num = String(c.number ?? 7);
    const roundel = (x, y, r, flip) => {
      ctx.save();
      ctx.translate(x, y);
      if (flip) ctx.scale(-1, 1);
      ctx.fillStyle = '#f7f7f7';
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = r * 0.12; ctx.strokeStyle = D; ctx.stroke();
      ctx.fillStyle = '#15171c';
      ctx.font = `900 ${Math.round(r * (num.length > 1 ? 1.1 : 1.3))}px system-ui, Arial Black, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(num, 0, r * 0.06);
      ctx.restore();
    };
    // flanks: the right region is mirrored by flank(), so pre-flip text there
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, SIDE_H); ctx.clip(); roundel(W * 0.47, fy(0.6), 62, false); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(0, SIDE_H, W, SIDE_H); ctx.clip(); roundel(W * 0.53, SIDE_H + fy(0.6), 62, false); ctx.restore();
    top(() => {
      ctx.save(); ctx.translate(W * 0.5, 160); ctx.rotate(Math.PI / 2);
      roundel(0, 0, 70, false); ctx.restore();
    });
  }
  ctx.restore();
}

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(h, a) { const [r, g, b] = hexToRgb(h); return `rgba(${r},${g},${b},${a})`; }
function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}
function seeded(s) { return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
