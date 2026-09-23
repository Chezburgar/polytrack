// WebGL renderer, lighting rig and optional post-processing, with quality tiers.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const QUALITY = {
  low: { pixelRatio: 0.75, shadows: false, shadowSize: 0, bloom: false, samples: 0, decor: 0.45, far: 700 },
  medium: { pixelRatio: 1, shadows: true, shadowSize: 1024, bloom: false, samples: 0, decor: 0.75, far: 900 },
  high: { pixelRatio: 1, shadows: true, shadowSize: 2048, bloom: true, samples: 2, decor: 1, far: 1100 },
  ultra: { pixelRatio: 2, shadows: true, shadowSize: 4096, bloom: true, samples: 4, decor: 1.25, far: 1400 },
};

export class Renderer {
  constructor(canvas, quality = 'high') {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false, stencil: false,
    });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 2400);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x445544, 1.0);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sunDir = new THREE.Vector3(0.4, 0.8, 0.3).normalize();
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.composer = null;
    this.size = { w: 1, h: 1 };
    this.fixedSize = null;
    this.setQuality(quality);
  }

  setQuality(name) {
    this.qualityName = QUALITY[name] ? name : 'high';
    const q = (this.quality = QUALITY[this.qualityName]);
    const r = this.renderer;
    r.shadowMap.enabled = q.shadows;
    this.sun.castShadow = q.shadows;
    if (q.shadows) {
      this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
      const c = this.sun.shadow.camera;
      const ext = q.shadowSize >= 4096 ? 90 : q.shadowSize >= 2048 ? 70 : 55;
      c.left = -ext; c.right = ext; c.top = ext; c.bottom = -ext; c.near = 1; c.far = 600;
      c.updateProjectionMatrix();
    }
    this.scene.traverse((o) => { if (o.material) { const m = Array.isArray(o.material) ? o.material : [o.material]; m.forEach((x) => (x.needsUpdate = true)); } });
    this._buildComposer();
    this.resize();
  }

  _buildComposer() {
    if (this.composer) { this.composer.dispose?.(); this.composer = null; }
    const q = this.quality;
    if (!q.bloom) return;
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: q.samples || 0 });
    const comp = new EffectComposer(this.renderer, rt);
    comp.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 1.05);
    comp.addPass(this.bloom);
    comp.addPass(new OutputPass());
    this.composer = comp;
  }

  setBloom(strength, threshold = 1.05) {
    if (this.bloom) { this.bloom.strength = strength; this.bloom.threshold = threshold; }
  }

  resize() {
    const w = this.fixedSize ? this.fixedSize[0] : this.canvas.clientWidth || window.innerWidth;
    const h = this.fixedSize ? this.fixedSize[1] : this.canvas.clientHeight || window.innerHeight;
    const ratio = Math.min(this.quality.pixelRatio * Math.min(window.devicePixelRatio || 1, 2), 2.5);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    if (this.composer) { this.composer.setPixelRatio(ratio); this.composer.setSize(w, h); }
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.size = { w, h };
  }

  // keep the shadow frustum centred on what the camera is looking at
  followShadow(target) {
    if (!this.quality.shadows) return;
    const ext = this.sun.shadow.camera.right;
    // snap to texel grid to stop shadow shimmer while driving
    const texel = (ext * 2) / this.quality.shadowSize;
    const cx = Math.round(target.x / texel) * texel, cy = Math.round(target.y / texel) * texel, cz = Math.round(target.z / texel) * texel;
    this.sun.target.position.set(cx, cy, cz);
    this.sun.position.set(cx + this.sunDir.x * 250, cy + this.sunDir.y * 250, cz + this.sunDir.z * 250);
    this.sun.target.updateMatrixWorld();
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
