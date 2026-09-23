// Top-down track drawing for minimaps and track-select thumbnails.
export function mapTransform(track, w, h, pad = 10) {
  const b = track.bounds;
  const bw = b.maxX - b.minX, bh = b.maxZ - b.minZ;
  const scale = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
  const ox = pad + ((w - pad * 2) - bw * scale) / 2;
  const oy = pad + ((h - pad * 2) - bh * scale) / 2;
  // x flipped so the map matches the view from above with +z up the screen
  return {
    scale,
    x: (px) => ox + (b.maxX - px) * scale,
    y: (pz) => oy + (b.maxZ - pz) * scale,
  };
}

export function drawTrack(ctx, track, w, h, opt = {}) {
  const pad = opt.pad ?? 10;
  const T = mapTransform(track, w, h, pad);
  const S = track.samples;
  const lw = opt.width ?? Math.max(2, Math.min(7, T.scale * 12));
  const minY = track.bounds.minY, maxY = Math.max(track.bounds.maxY, minY + 1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // outline
  const path = (from, to) => {
    ctx.beginPath();
    let pen = false;
    for (let i = from; i < to; i++) {
      const s = S[i % S.length];
      if (!s.road) { pen = false; continue; }
      const x = T.x(s.p.x), y = T.y(s.p.z);
      if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
    }
  };
  const end = track.closed ? S.length + 1 : S.length;
  ctx.strokeStyle = opt.outline ?? 'rgba(0,0,0,0.55)';
  ctx.lineWidth = lw + 3;
  path(0, end); ctx.stroke();
  // body, shaded by height so bridges read over the road beneath
  for (let i = 0; i < end - 1; i++) {
    const a = S[i % S.length], b = S[(i + 1) % S.length];
    if (!a.road || !b.road) continue;
    const k = (a.p.y - minY) / (maxY - minY);
    ctx.strokeStyle = opt.color ? opt.color(k, a) : `hsl(${205 - k * 30}, ${20 + k * 20}%, ${78 + k * 18}%)`;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(T.x(a.p.x), T.y(a.p.z));
    ctx.lineTo(T.x(b.p.x), T.y(b.p.z));
    ctx.stroke();
  }
  // jumps as dashed gaps
  ctx.setLineDash([2, 3]);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = Math.max(1, lw * 0.4);
  ctx.beginPath();
  for (let i = 0; i < S.length; i++) {
    if (S[i].road) continue;
    ctx.moveTo(T.x(S[i].p.x), T.y(S[i].p.z));
    const n = S[i + 1];
    if (n) ctx.lineTo(T.x(n.p.x), T.y(n.p.z));
  }
  ctx.stroke();
  ctx.setLineDash([]);
  // gates
  if (opt.gates !== false) {
    const dot = (g, col, r) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(T.x(g.p.x), T.y(g.p.z), r, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const cp of track.checkpoints) dot(cp, '#ffd23c', Math.max(1.5, lw * 0.45));
    if (!track.closed) dot(track.finish, '#ffffff', Math.max(2, lw * 0.6));
    dot(track.start, '#3dff8b', Math.max(2, lw * 0.6));
  }
  return T;
}
