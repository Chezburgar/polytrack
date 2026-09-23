// Headless race of one AI car over a track on the real physics. Shared by the
// validator (tools/sim.mjs) and the medal generator (tools/medals.mjs).
import { Vector3 } from 'three';
import { loadTrack } from '../src/track/load.js';
import { Car } from '../src/physics/car.js';
import { AIDriver } from '../src/game/ai.js';
import { Progress } from '../src/game/progress.js';
import { RaceState } from '../src/game/race.js';
import { respawnReason, missedGate } from '../src/game/rules.js';

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
    const why = respawnReason(rs, car, prog, track, DT) || (missedGate(race, prog, track) ? 'missed checkpoint' : null);
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

