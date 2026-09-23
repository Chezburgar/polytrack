// Assembles the visible world for a track: sky, lighting, fog, road, scenery.
import * as THREE from 'three';
import { buildSky, followSky } from './sky.js';
import { buildTrackView } from './trackview.js';
import { buildScenery } from './scenery.js';

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
