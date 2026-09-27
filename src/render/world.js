// Assembles the visible world for a track: sky, lighting, fog, road, scenery.
import * as THREE from 'three';
import { buildSky, followSky } from './sky.js';
import { buildTrackView } from './trackview.js';
import { buildScenery } from './scenery.js';
import { buildWeather } from './weather.js';
import { mulberry32, hashString } from '../util/math.js';

export class WorldView {
  constructor(renderer, loaded, { decor = 1 } = {}) {
    this.renderer = renderer;
    const { theme, track, geo } = loaded;
    this.theme = theme;
    const scene = renderer.scene;
    this.group = new THREE.Group();
    this.group.name = 'world';
    this.sky = buildSky(theme, track.def.id.length);
    this.track = buildTrackView(geo, theme);
    this.scenery = buildScenery(track, theme, { decor, terrain: loaded.terrain });
    this.group.add(this.sky, this.track, this.scenery);
    this.weather = buildWeather(theme, hashString(track.def.id));
    if (this.weather) this.group.add(this.weather.object);
    this.rnd = mulberry32(hashString(track.def.id + ':storm'));
    this.nextBolt = 4 + this.rnd() * 6;
    scene.add(this.group);
    this.applyLighting();
    this.envMap = this.makeEnvMap();
  }

  applyLighting() {
    const th = this.theme, r = this.renderer, scene = r.scene;
    scene.fog = new THREE.Fog(th.fog.color, th.fog.near, Math.min(th.fog.far, r.quality.far));
    scene.background = new THREE.Color(th.sky.horizon);
    r.hemi.color.set(th.hemi.sky);
    r.hemi.groundColor.set(th.hemi.ground);
    r.hemi.intensity = th.hemi.intensity;
    r.sun.color.set(th.sun.color);
    r.sun.intensity = th.sun.intensity;
    r.sunDir.set(...th.sun.dir).normalize();
    r.renderer.toneMappingExposure = th.exposure ?? 1.0;
    r.setBloom(th.bloom ?? 0.45, th.bloomThreshold ?? 1.05);
  }

  // small environment map from the sky gradient for car paint reflections
  makeEnvMap() {
    const r = this.renderer.renderer;
    const pmrem = new THREE.PMREMGenerator(r);
    const envScene = new THREE.Scene();
    const sky = buildSky({ ...this.theme, clouds: null, mountains: null }, 1);
    envScene.add(sky);
    // a ground disc so reflections have a horizon
    const g = new THREE.Mesh(new THREE.CircleGeometry(900, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(this.theme.groundColors?.[0] ?? 0x555555).multiplyScalar(0.6) }));
    g.rotation.x = -Math.PI / 2;
    g.position.y = -30;
    envScene.add(g);
    const rt = pmrem.fromScene(envScene, 0.02, 1, 1500);
    pmrem.dispose();
    sky.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
    return rt.texture;
  }

  update(t, camPos, dt = 1 / 60) {
    followSky(this.sky, camPos);
    this.scenery.userData.update?.(t, dt, camPos);
    this.weather?.update(dt, camPos);
    const u = this.sky.userData.dome.material.uniforms;
    u.time.value = t;
    if (this.theme.lightning) this.storm(dt, camPos, u);
  }

  // Lightning: every few seconds a bolt somewhere out on the plain, the sky and
  // the land lit up for a moment (twice, flickering), thunder a little later.
  storm(dt, camPos, u) {
    const r = this.renderer;
    this.nextBolt -= dt;
    if (this.nextBolt <= 0) {
      this.nextBolt = 5 + this.rnd() * 9;
      this.flashT = 0;
      this.showBolt(camPos);
      const dist = 250 + this.rnd() * 600;
      this.onThunder?.(dist / 340, dist); // sound takes its time
    }
    if (this.flashT != null) {
      this.flashT += dt;
      const f = this.flashT;
      // two quick strikes, fading
      const k = f < 0.08 ? 1 : f < 0.16 ? 0.25 : f < 0.24 ? 0.8 : Math.max(0, 1 - (f - 0.24) / 0.35) * 0.5;
      u.flash.value = k;
      r.hemi.intensity = this.theme.hemi.intensity * (1 + k * 3);
      if (this.bolt) this.bolt.visible = f < 0.3;
      if (f > 0.6) { this.flashT = null; u.flash.value = 0; r.hemi.intensity = this.theme.hemi.intensity; }
    }
  }

  showBolt(camPos) {
    if (!this.bolt) {
      const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(0xd8e4ff).multiplyScalar(3), fog: false });
      this.bolt = new THREE.LineSegments(new THREE.BufferGeometry(), mat);
      this.bolt.frustumCulled = false;
      this.group.add(this.bolt);
    }
    const rnd = this.rnd;
    const a = rnd() * Math.PI * 2, d = 380 + rnd() * 420;
    let x = camPos.x + Math.cos(a) * d, z = camPos.z + Math.sin(a) * d, y = 420;
    const pts = [];
    // a jagged main stroke with a couple of forks
    const stroke = (x0, y0, z0, steps, spread) => {
      let px = x0, py = y0, pz = z0;
      for (let i = 0; i < steps; i++) {
        const nx = px + (rnd() - 0.5) * spread, ny = py - (18 + rnd() * 26), nz = pz + (rnd() - 0.5) * spread;
        pts.push(px, py, pz, nx, ny, nz);
        px = nx; py = ny; pz = nz;
        if (i > 2 && rnd() < 0.18 && steps > 6) stroke(px, py, pz, 4 + Math.floor(rnd() * 4), spread * 1.3);
      }
    };
    stroke(x, y, z, 16, 34);
    this.bolt.geometry.dispose();
    this.bolt.geometry = new THREE.BufferGeometry();
    this.bolt.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.bolt.visible = true;
  }

  dispose() {
    this.renderer.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.map?.dispose(); m.dispose(); });
    });
    this.envMap?.dispose();
  }
}
