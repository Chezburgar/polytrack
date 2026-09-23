// Skid marks, low-poly smoke puffs, sparks and boost flames.
import * as THREE from 'three';

const MAX_SKID = 2400;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'effects';
    scene.add(this.group);

    // skid marks: ring buffer of quads laid on the road
    const pos = new Float32Array(MAX_SKID * 6 * 3);
    const alpha = new Float32Array(MAX_SKID * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(0x121315) } },
      vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 color; varying float vA; void main(){ gl_FragColor = vec4(color, vA * 0.55); }`,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
    });
    this.skidMesh = new THREE.Mesh(g, m);
    this.skidMesh.frustumCulled = false;
    this.group.add(this.skidMesh);
    this.skidHead = 0;
    this.skidLast = new Map();

    // smoke puffs
    this.puffMax = 220;
    const pm = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x555a60, flatShading: true, transparent: true, opacity: 0.42, depthWrite: false });
    this.puffs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), pm, this.puffMax);
    this.puffs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.puffs.frustumCulled = false;
    this.puffs.count = 0;
    this.puffData = [];
    this.group.add(this.puffs);

    // sparks
    this.sparkMax = 160;
    const sm = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc15a).multiplyScalar(3) });
    this.sparks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.05, 0.35), sm, this.sparkMax);
    this.sparks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sparks.frustumCulled = false;
    this.sparks.count = 0;
    this.sparkData = [];
    this.group.add(this.sparks);
    // confetti
    this.confMax = 260;
    this.conf = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.18, 0.09), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), this.confMax);
    this.conf.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.conf.frustumCulled = false;
    this.conf.count = 0;
    this.confData = [];
    this.group.add(this.conf);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  // continuous skid trail for (key) at contact point p with surface normal n, travel dir d
  skid(key, p, n, d, strength) {
    const last = this.skidLast.get(key);
    if (!last) { this.skidLast.set(key, { p: p.clone(), n: n.clone(), t: 0 }); return; }
    const dist = last.p.distanceTo(p);
    if (dist < 0.35) return;
    if (dist > 3) { last.p.copy(p); last.n.copy(n); return; }
    const side = new THREE.Vector3().crossVectors(n, d).normalize().multiplyScalar(0.14);
    const lift = 0.02;
    const a0 = last.p.clone().add(side).addScaledVector(last.n, lift), a1 = last.p.clone().sub(side).addScaledVector(last.n, lift);
    const b0 = p.clone().add(side).addScaledVector(n, lift), b1 = p.clone().sub(side).addScaledVector(n, lift);
    const pos = this.skidMesh.geometry.attributes.position;
    const al = this.skidMesh.geometry.attributes.alpha;
    const i = this.skidHead;
    const verts = [a0, b0, b1, a0, b1, a1];
    for (let k = 0; k < 6; k++) {
      pos.array[(i * 6 + k) * 3] = verts[k].x; pos.array[(i * 6 + k) * 3 + 1] = verts[k].y; pos.array[(i * 6 + k) * 3 + 2] = verts[k].z;
      al.array[i * 6 + k] = Math.min(1, strength);
    }
    pos.addUpdateRange(i * 18, 18);
    al.addUpdateRange(i * 6, 6);
    pos.needsUpdate = true;
    al.needsUpdate = true;
    this.skidHead = (i + 1) % MAX_SKID;
    last.p.copy(p);
    last.n.copy(n);
  }
  endSkid(key) { this.skidLast.delete(key); }

  puff(p, v, size = 0.5, color = 0xe9ecef, life = 1.1) {
    if (this.puffData.length >= this.puffMax) this.puffData.shift();
    this.puffData.push({ p: p.clone(), v: v.clone(), size, age: 0, life, spin: Math.random() * 6, color: new THREE.Color(color) });
  }

  spark(p, v) {
    if (this.sparkData.length >= this.sparkMax) this.sparkData.shift();
    this.sparkData.push({ p: p.clone(), v: v.clone(), age: 0, life: 0.35 + Math.random() * 0.3 });
  }

  confetti(p, v) {
    const cols = [0xff3d5a, 0xffd23c, 0x39e6ff, 0x3dff8b, 0xff8a3d, 0xb77cff, 0xffffff];
    for (let i = 0; i < 220; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random();
      this.confData.push({
        p: p.clone().addScaledVector(v, 0.35).add(new THREE.Vector3(Math.cos(a) * r * 3, 2 + Math.random() * 2, Math.sin(a) * r * 3)),
        v: v.clone().multiplyScalar(0.55).add(new THREE.Vector3(Math.cos(a) * (2 + Math.random() * 5), 5 + Math.random() * 9, Math.sin(a) * (2 + Math.random() * 5))),
        spin: new THREE.Vector3(Math.random() * 12, Math.random() * 12, Math.random() * 12), rot: new THREE.Euler(),
        age: 0, life: 2.4 + Math.random() * 1.6, color: new THREE.Color(cols[i % cols.length]).multiplyScalar(1.6),
      });
    }
    if (this.confData.length > this.confMax) this.confData.splice(0, this.confData.length - this.confMax);
  }

  update(dt) {
    const m = this._m, q = this._q, s = this._s;
    // confetti flutters: strong drag, gentle gravity
    let cn = 0;
    for (let i = this.confData.length - 1; i >= 0; i--) if ((this.confData[i].age += dt) >= this.confData[i].life) this.confData.splice(i, 1);
    for (const d of this.confData) {
      d.v.multiplyScalar(1 - dt * 1.6);
      d.v.y -= 6 * dt;
      d.p.addScaledVector(d.v, dt);
      d.rot.set(d.rot.x + d.spin.x * dt, d.rot.y + d.spin.y * dt, d.rot.z + d.spin.z * dt);
      q.setFromEuler(d.rot);
      const k = Math.min(1, (d.life - d.age) * 2);
      m.compose(d.p, q, s.set(k, k, k));
      this.conf.setMatrixAt(cn, m);
      this.conf.setColorAt(cn, d.color);
      cn++;
    }
    this.conf.count = cn;
    this.conf.instanceMatrix.needsUpdate = true;
    if (this.conf.instanceColor) this.conf.instanceColor.needsUpdate = true;
    let n = 0;
    for (let i = this.puffData.length - 1; i >= 0; i--) {
      const d = this.puffData[i];
      d.age += dt;
      if (d.age >= d.life) { this.puffData.splice(i, 1); continue; }
    }
    for (const d of this.puffData) {
      d.p.addScaledVector(d.v, dt);
      d.v.multiplyScalar(1 - dt * 2.2);
      d.v.y += dt * 0.9;
      const k = d.age / d.life;
      const sc = d.size * (0.35 + k * 1.3) * (1 - k * k * 0.9);
      q.setFromAxisAngle(this._p.set(0.3, 1, 0.2).normalize(), d.spin + d.age);
      m.compose(d.p, q, s.set(sc, sc, sc));
      this.puffs.setMatrixAt(n, m);
      this.puffs.setColorAt(n, this._c.copy(d.color));
      n++;
    }
    this.puffs.count = n;
    this.puffs.instanceMatrix.needsUpdate = true;
    if (this.puffs.instanceColor) this.puffs.instanceColor.needsUpdate = true;

    n = 0;
    for (let i = this.sparkData.length - 1; i >= 0; i--) if ((this.sparkData[i].age += dt) >= this.sparkData[i].life) this.sparkData.splice(i, 1);
    for (const d of this.sparkData) {
      d.v.y -= 14 * dt;
      d.p.addScaledVector(d.v, dt);
      q.setFromUnitVectors(this._p.set(0, 0, 1), s.copy(d.v).normalize());
      const k = 1 - d.age / d.life;
      m.compose(d.p, q, s.set(k, k, 0.4 + k));
      this.sparks.setMatrixAt(n++, m);
    }
    this.sparks.count = n;
    this.sparks.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.skidLast.clear();
    const pos = this.skidMesh.geometry.attributes.alpha;
    pos.array.fill(0);
    pos.needsUpdate = true;
    this.puffData.length = 0;
    this.sparkData.length = 0;
    this.confData.length = 0;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
  }
}

// Boost flame cones attached behind a car model.
export function addFlames(model, color = '#39e6ff') {
  const g = new THREE.ConeGeometry(0.13, 1, 7, 1, true);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, -0.5);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const core = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(3), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const flames = [];
  for (const x of [0.45, -0.45]) {
    const f = new THREE.Mesh(g, mat);
    const c = new THREE.Mesh(g, core);
    c.scale.set(0.5, 0.5, 0.6);
    f.add(c);
    f.position.set(x, 0.3 - 0.572, -2.2);
    f.visible = false;
    model.group.add(f);
    flames.push(f);
  }
  model.flames = flames;
  model.materials.push(mat, core);
  model.setBoost = (level, t) => {
    for (const f of flames) {
      f.visible = level > 0.02;
      const flick = 0.75 + Math.sin(t * 60 + f.position.x * 10) * 0.12 + Math.random() * 0.15;
      f.scale.set(1 + level * 0.3, 1 + level * 0.3, (0.6 + level * 1.6) * flick);
    }
  };
}
