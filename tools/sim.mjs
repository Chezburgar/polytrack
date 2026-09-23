// Headless validator: an AI bot drives every track (or the ones named) on the
// real physics and must finish. Prints time, respawns and trouble spots.
// Usage: node tools/sim.mjs [trackId ...] [--skill=1] [--trace]
import { Vector3 } from 'three';
import { TRACKS } from '../src/track/tracks.js';
import { loadTrack } from '../src/track/load.js';
import { Car } from '../src/physics/car.js';
import { AIDriver } from '../src/game/ai.js';
import { Progress } from '../src/game/progress.js';
import { RaceState } from '../src/game/race.js';
import { respawnReason } from '../src/game/rules.js';

const args = process.argv.slice(2);
const ids = args.filter((a) => !a.startsWith('--'));
const skill = +(args.find((a) => a.startsWith('--skill=')) || '--skill=1').slice(8);
const trace = args.includes('--trace');
const DT = 1 / 120;

export function simulate(def, { skill = 1, maxTime = 400, trace = false, seed = 1 } = {}) {
  const T0 = performance.now();
  const L = loadTrack(def);
  const tLoad = performance.now() - T0;
  const { track, world, line, speeds } = L;
  const race = new RaceState(track);
  const car = new Car(world);
  car.reset(race.spawn.pos, race.spawn.quat);
  const ai = new AIDriver(track, line, speeds, { skill, seed });
  const prog = new Progress(track, track.start.index);
  prog.update(car.pos);
  let t = 0;
  const prev = new Vector3();
  const events = [];
  const problems = [];
  let maxAir = 0, vmax = 0, respawns = 0;
  const rs = {};
  const minY = track.bounds.minY;
  const doRespawn = (why) => {
    respawns++;
    problems.push(`${why} at s=${prog.s?.toFixed(0)} (piece ${track.samples[prog.index].piece}: "${track.pieces[track.samples[prog.index].piece].src}") t=${t.toFixed(1)}`);
    const r = race.respawn;
    car.reset(r.pos, r.quat, r.speed || 0);
    rs.offTime = rs.flipTime = rs.stallAir = 0;
    prog.reset(r.index ?? track.start.index);
    prog.update(car.pos);
  };
  let lastTrace = 0;
  while (t < maxTime && !race.finished) {
    prev.copy(car.pos);
    ai.drive(car, prog, DT);
    car.step(DT);
    t += DT;
    prog.update(car.pos);
    const ev = race.cross(prev, car.pos, t, DT, car.forwardSpeed);
    if (ev) events.push(`${ev.kind}@${ev.time.toFixed(2)}`);
    vmax = Math.max(vmax, car.speed);
    maxAir = Math.max(maxAir, car.airTime);
    if (ai.wantRespawn) { ai.wantRespawn = false; doRespawn('stuck'); continue; }
    const why = respawnReason(rs, car, prog, track, DT);
    if (why) { doRespawn(why); continue; }
    if (car.nanReset) { problems.push('NaN reset at t=' + t.toFixed(2)); car.nanReset = false; }
    if (trace && t - lastTrace > 0.5) {
      lastTrace = t;
      console.log(`t=${t.toFixed(1)} s=${prog.s.toFixed(0)} v=${car.speed.toFixed(1)} vT=${speeds[prog.index].toFixed(1)} lat=${prog.lat.toFixed(1)} line=${line[prog.index].toFixed(1)} air=${car.grounded ? 0 : car.airTime.toFixed(2)} upY=${car.up.y.toFixed(2)} kind=${track.samples[prog.index].kind}`);
    }
  }
  return {
    id: def.id, finished: race.finished, time: race.finishTime, respawns, vmax, maxAir, events, problems,
    length: track.length, samples: track.samples.length, tris: world.count, loadMs: tLoad, closure: track.closure,
  };
}

const list = ids.length ? TRACKS.filter((t) => ids.includes(t.id)) : TRACKS;
for (const def of list) {
  const r = simulate(def, { skill, trace });
  const c = r.closure ? ` closure=${r.closure.dist.toFixed(2)}m/${r.closure.yawDeg.toFixed(1)}deg` : '';
  console.log(`${r.finished ? 'OK  ' : 'FAIL'} ${def.id.padEnd(20)} ${r.finished ? r.time.toFixed(2) + 's' : '  --  '} len=${r.length.toFixed(0)}m respawns=${r.respawns} vmax=${(r.vmax * 3.6).toFixed(0)}km/h air=${r.maxAir.toFixed(2)}s tris=${r.tris} load=${r.loadMs.toFixed(0)}ms${c}`);
  for (const p of r.problems.slice(0, 8)) console.log('     ' + p);
  if (!r.finished) console.log('     events: ' + r.events.join(' '));
}
