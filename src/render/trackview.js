// Wraps generated track arrays into three.js meshes: flat-shaded vertex-colour
// chunks (frustum culled), road decals, glowing boost pads/banners, and the
// start lights the countdown drives.
import * as THREE from 'three';

export function makeGeometry(pos, col) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export function buildTrackView(geo, theme) {
  const group = new THREE.Group();
  group.name = 'track';
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  for (const c of geo.chunks) {
    const m = new THREE.Mesh(makeGeometry(c.pos, c.col), mat);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  if (geo.decal.pos.length) {
    const dm = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const d = new THREE.Mesh(makeGeometry(geo.decal.pos, geo.decal.col), dm);
    d.receiveShadow = true;
    group.add(d);
  }
  if (geo.glow.pos.length) {
    // boost pads and banners: unlit and pushed above 1.0 so bloom picks them up
    const col = geo.glow.col.slice();
    for (let i = 0; i < col.length; i++) col[i] *= 2.2;
    const gm = new THREE.MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
    const g = new THREE.Mesh(makeGeometry(geo.glow.pos, col), gm);
    group.add(g);
    group.userData.glowMat = gm;
  }
  // start lights: five lamps under the start gantry
  const start = geo.gates.find((g) => g.kind === 'start');
  const lights = [];
  if (start) {
    const lampGeo = new THREE.SphereGeometry(0.34, 10, 6);
    const housing = new THREE.BoxGeometry(0.9, 0.9, 0.5);
    const hMat = new THREE.MeshLambertMaterial({ color: 0x15171b });
    for (let i = 0; i < 5; i++) {
      const x = (2 - i) * 1.25; // lamp 0 on the driver's left
      const p = start.center.clone().addScaledVector(start.lat, x).addScaledVector(start.up, -1.25);
      const h = new THREE.Mesh(housing, hMat);
      h.position.copy(p);
      h.lookAt(p.clone().add(start.fwd));
      const lm = new THREE.MeshBasicMaterial({ color: 0x2a0a0a });
      const lamp = new THREE.Mesh(lampGeo, lm);
      lamp.position.copy(p).addScaledVector(start.fwd, -0.28);
      const front = new THREE.Mesh(lampGeo, lm); // same material, so it follows
      front.position.copy(p).addScaledVector(start.fwd, 0.28);
      group.add(h, lamp, front);
      lights.push(lamp);
    }
  }
  group.userData.startLights = lights;
  return group;
}

// n lamps lit red (1..5), or 'go' for all green, or 0 for off
export function setStartLights(view, state) {
  const lights = view.userData.startLights || [];
  lights.forEach((l, i) => {
    if (state === 'go') l.material.color.setRGB(0.12, 1.9, 0.3);
    else if (i < state) l.material.color.setRGB(2.2, 0.035, 0.02);
    else l.material.color.setRGB(0.09, 0.02, 0.02);
  });
}
