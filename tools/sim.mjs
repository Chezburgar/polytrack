// Headless validator: an AI bot drives every track (or the ones named) on the
// real physics and must finish. Prints time, respawns and trouble spots.
// Usage: node tools/sim.mjs [trackId ...] [--skill=1] [--trace]
import { TRACKS } from '../src/track/tracks.js';
import { simulate } from './simcore.mjs';

const args = process.argv.slice(2);
const ids = args.filter((a) => !a.startsWith('--'));
const skill = +(args.find((a) => a.startsWith('--skill=')) || '--skill=1').slice(8);
const trace = args.includes('--trace');

const list = ids.length ? TRACKS.filter((t) => ids.includes(t.id)) : TRACKS;
for (const def of list) {
  const r = simulate(def, { skill, trace });
  const c = r.closure ? ` closure=${r.closure.dist.toFixed(2)}m/${r.closure.yawDeg.toFixed(1)}deg` : '';
  console.log(`${r.finished ? 'OK  ' : 'FAIL'} ${def.id.padEnd(20)} ${r.finished ? r.time.toFixed(2) + 's' : '  --  '} len=${r.length.toFixed(0)}m respawns=${r.respawns} vmax=${(r.vmax * 3.6).toFixed(0)}km/h air=${r.maxAir.toFixed(2)}s tris=${r.tris} load=${r.loadMs.toFixed(0)}ms${c}`);
  for (const p of r.problems.slice(0, 8)) console.log('     ' + p);
  if (!r.finished) console.log('     events: ' + r.events.join(' '));
}
