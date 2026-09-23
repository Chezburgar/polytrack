// Syntax-checks every module under src/ and tools/ (node --check), then
// builds every track headlessly to catch data errors.
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.m?js$/.test(f)) files.push(p); } };
walk(join(root, 'src'));
walk(join(root, 'tools'));
let bad = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { bad++; console.log('SYNTAX', f.slice(root.length + 1), '\n' + String(e.stderr).split('\n').slice(0, 6).join('\n')); }
}
console.log(`${files.length - bad}/${files.length} modules parse`);
const { TRACKS } = await import('../src/track/tracks.js');
const { buildTrack } = await import('../src/track/builder.js');
const { buildTrackGeometry } = await import('../src/track/geometry.js');
const { getTheme } = await import('../src/track/themes.js');
for (const def of TRACKS) {
  try {
    const t = buildTrack(def);
    const g = buildTrackGeometry(t, getTheme(def.theme));
    const tris = g.chunks.reduce((a, c) => a + c.pos.length / 9, 0);
    const cl = t.closure ? ` closure ${t.closure.dist.toFixed(2)} m / ${t.closure.yawDeg.toFixed(1)} deg` : '';
    // two stretches of road overlapping at nearly the same height = a crash
    const S = t.samples;
    const clashes = [];
    for (let i = 0; i < S.length; i += 3) {
      if (!S[i].road) continue;
      for (let j = i + 1; j < S.length; j += 3) {
        if (!S[j].road) continue;
        let ds = Math.abs(S[j].s - S[i].s);
        if (t.closed) ds = Math.min(ds, t.length - ds);
        if (ds < 45) continue;
        const dx = S[i].p.x - S[j].p.x, dz = S[i].p.z - S[j].p.z;
        const lim = S[i].hw + S[j].hw + 3;
        if (dx * dx + dz * dz > lim * lim) continue;
        if (Math.abs(S[i].p.y - S[j].p.y) < 6.5 && S[i].kind !== 'LOOP' && S[j].kind !== 'LOOP') clashes.push(`s=${S[i].s.toFixed(0)}/${S[j].s.toFixed(0)} dy=${(S[i].p.y - S[j].p.y).toFixed(1)}`);
      }
    }
    // kickers need a straight, settled run-up or cars launch crooked
    t.pieces.forEach((p, k) => {
      if (p.type !== 'K') return;
      let run = 0;
      for (let j = k - 1; j >= 0 && t.pieces[j].type === 'S'; j--) run += t.pieces[j].len;
      if (run < 60) console.log(`WARN ${def.id}: kicker at piece ${k} has only ${run.toFixed(0)} m of straight run-up`);
    });
    if (clashes.length) { bad++; console.log('CLASH', def.id, clashes.length, clashes.slice(0, 4).join('  ')); }
    console.log(`track ${def.id}: ${t.samples.length} samples, ${(t.length / 1000).toFixed(2)} km, ${tris} tris, ${t.checkpoints.length} cps${cl}`);
  } catch (e) { bad++; console.log('TRACK FAIL', def.id, e.message); }
}
process.exitCode = bad ? 1 : 0;
