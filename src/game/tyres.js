// Tyres for the rest of the race, from the pit stop commands:
//   spare  /pitstop: the botched stop - a tiny yellow spare on the rear right that
//          pulls to one side and wobbles; a little less grip and power
//   pro    /pitstop pro: a proper stop - gold race wheels, a lot more grip and power
//          and a higher top speed
//   junk   /pitstopnuke: four wrong wheels (square, tiny, oval, a trolley wheel) -
//          slow, and it fights you every metre
// tyreLook() is drawn on every client; the physics (tyreSpec, the handicap) belong
// to whoever drives the car.
import * as THREE from 'three';
import { wheelGeometry } from '../car/model.js';

export const TYRES = {
  spare: { spec: { mu: 0.84, enginePower: 0.9, engineForceMax: 0.92 }, pull: 0.07, wobble: 0.1 },
  pro: { spec: { mu: 1.3, enginePower: 1.4, engineForceMax: 1.3, dragC: 0.9, downforce: 1.5, maxSteer: 1.1 } },
  junk: { spec: { mu: 0.55, enginePower: 0.45, engineForceMax: 0.5, dragC: 1.35, maxSteer: 0.85 }, pull: 0.16, wobble: 0.32, drift: 0.14, bumps: true },
};

// the car's spec on these tyres, from its own untouched spec
export function tyreSpec(base, kind) {
  const m = TYRES[kind]?.spec || {};
  const s = { ...base };
  for (const k in m) s[k] = base[k] * m[k];
  return s;
}

let proGeo = null, squareGeo = null;

export function tyreLook(model, kind) {
  const mats = model.tyreMats || (model.tyreMats = {});
  const mat = (name, color) => {
    if (!mats[name]) { mats[name] = new THREE.MeshLambertMaterial({ color, flatShading: true }); model.materials.push(mats[name]); }
    return mats[name];
  };
  model.wheels.forEach((w, i) => {
    const s = w.spin, u = s.userData;
    if (!u.orig) u.orig = { geo: s.geometry, mat: s.material, scale: s.scale.clone(), y: s.position.y };
    s.geometry = u.orig.geo; s.material = u.orig.mat; s.scale.copy(u.orig.scale); s.position.y = u.orig.y;
    if (kind === 'spare' && i === 3) { s.scale.multiplyScalar(0.62); s.material = mat('yellow', 0xffd23c); s.position.y = -0.13; }
    if (kind === 'pro') s.geometry = proGeo || (proGeo = wheelGeometry('turbine', '#ffc83a'));
    if (kind === 'junk') {
      // wheel order: front-left, front-right, rear-left, rear-right
      if (i === 0) { s.geometry = squareGeo || (squareGeo = new THREE.BoxGeometry(0.26, 0.64, 0.64)); s.material = mat('wood', 0x9a6a3a); }
      if (i === 1) { s.scale.multiplyScalar(0.5); s.material = mat('yellow', 0xffd23c); s.position.y = -0.18; }
      if (i === 2) { s.scale.y *= 1.35; s.scale.z *= 0.75; s.material = mat('pink', 0xff6ab0); }
      if (i === 3) { s.scale.multiplyScalar(0.4); s.material = mat('trolley', 0x8aa0c0); s.position.y = -0.21; }
    }
  });
}
