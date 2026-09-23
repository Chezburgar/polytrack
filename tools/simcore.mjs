// Headless race of one AI car over a track on the real physics. Shared by the
// validator (tools/sim.mjs) and the medal generator (tools/medals.mjs); the
// stepping itself lives in src/game/verify.js so the track editor runs the
// exact same test in the browser.
import { Verifier } from '../src/game/verify.js';

export function simulate(def, { skill = 1, maxTime = 400, trace = false, seed = 1 } = {}) {
  const v = new Verifier(def, { skill, maxTime, trace, seed });
  while (!v.step(1e6));
  return v.result;
}
