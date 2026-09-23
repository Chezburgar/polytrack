// Garage: live 3D turntable plus every customisation option. Changes rebuild
// the model instantly and save to the profile.
import * as THREE from 'three';
import { h, icon, clear } from '../dom.js';
import { button } from '../ui.js';
import { buildCar, DEFAULT_CAR, FINISHES, RIMS, RIM_NAMES, SPOILERS, SPOILER_NAMES, TINTS } from '../../car/model.js';
import { BODIES, BODY_IDS } from '../../car/bodies.js';
import { LIVERIES } from '../../car/livery.js';
import { SWATCHES, GLOWS, PRESETS, randomBotCar } from '../../car/presets.js';
import { addFlames } from '../../render/effects.js';
import { buildSky } from '../../render/sky.js';
import { THEMES } from '../../track/themes.js';

class Showroom {
  constructor(renderer) {
    this.r = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 200);
    this.scene.background = new THREE.Color(0x11151f);
    this.scene.fog = new THREE.Fog(0x11151f, 16, 40);
    const hemi = new THREE.HemisphereLight(0xdbe6ff, 0x2a2f3a, 1.1);
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(4, 8, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -4; key.shadow.camera.right = 4; key.shadow.camera.top = 4; key.shadow.camera.bottom = -4;
    key.shadow.bias = -0.0005;
    const rim = new THREE.DirectionalLight(0x8fb7ff, 1.4);
    rim.position.set(-6, 3, -5);
    this.scene.add(hemi, key, rim);
    // faceted turntable + floor
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 40), new THREE.MeshLambertMaterial({ color: 0x1a1f2b }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.table = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.8, 0.18, 12), new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.4, metalness: 0.5, flatShading: true }));
    disc.position.y = 0.09;
    disc.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.7, 0.035, 4, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x39c6f0).multiplyScalar(2) }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.19;
    this.table.add(disc, ring);
    this.scene.add(this.table);
    // backdrop panels
    const panelMat = new THREE.MeshLambertMaterial({ color: 0x161b26, flatShading: true });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 1.2 - Math.PI * 0.1 + Math.PI;
      const p = new THREE.Mesh(new THREE.BoxGeometry(5.2, 9, 0.3), panelMat);
      p.position.set(Math.sin(a) * 14, 4, Math.cos(a) * 14);
      p.lookAt(0, 4, 0);
      this.scene.add(p);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.08, 0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(i % 2 ? 0x2f86eb : 0x39c6f0).multiplyScalar(1.6) }));
      strip.position.copy(p.position).add(new THREE.Vector3(0, -1.5 + (i % 3), 0));
      strip.lookAt(0, strip.position.y, 0);
      strip.translateZ(0.2);
      this.scene.add(strip);
    }
    // environment map for paint reflections
    const pmrem = new THREE.PMREMGenerator(renderer.renderer);
    const env = new THREE.Scene();
    env.add(buildSky({ ...THEMES.meadow, sky: { top: 0x3a4d6b, horizon: 0xc9d6ea, bottom: 0x1b2230, sun: 0xffffff }, clouds: null, mountains: null }));
    this.envMap = pmrem.fromScene(env, 0.02).texture;
    pmrem.dispose();
    this.angle = 0.6;
    this.spin = 0.18;
    this.drag = null;
    this.t = 0;
    this.pitch = 0.3;
    this.dist = 8.6;
  }

  setCar(custom) {
    if (this.model) { this.table.remove(this.model.group); this.model.dispose(); }
    this.model = buildCar(custom, { envMap: this.envMap });
    addFlames(this.model, custom.trail);
    this.model.group.position.y = 0.18 + 0.572;
    this.model.syncWheels([0, 1, 2, 3].map((i) => ({ comp: 0.087, steerAngle: i < 2 ? 0.28 : 0, spin: 0 })));
    this.table.add(this.model.group);
  }

  update(dt, rect) {
    this.t += dt;
    if (!this.drag) this.angle += this.spin * dt;
    this.table.rotation.y = this.angle;
    const r = this.r.renderer;
    const W = r.domElement.clientWidth, H = r.domElement.clientHeight;
    // frame the car in the right-hand part of the screen
    this.camera.aspect = W / Math.max(1, H);
    const cx = rect ? (rect.left + rect.width / 2) / W : 0.62;
    this.camera.setViewOffset(W, H, (0.5 - cx) * W, 0, W, H);
    this.camera.position.set(Math.sin(0.35) * this.dist, 1.2 + this.pitch * 4, Math.cos(0.35) * this.dist);
    this.camera.lookAt(0, 0.75, 0);
    this.camera.updateProjectionMatrix();
    if (this.model?.setBoost) this.model.setBoost(this.boostPreview ? 1 : 0, this.t);
    r.render(this.scene, this.camera);
  }

  dispose() {
    if (this.model) this.model.dispose();
    this.scene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
    this.envMap.dispose();
  }
}

const TABS = [
  ['body', 'Body'], ['paint', 'Paint'], ['livery', 'Livery'], ['wheels', 'Wheels'], ['aero', 'Aero'], ['extras', 'Extras'], ['presets', 'Presets'],
];

export class GarageScreen {
  constructor(ui) {
    this.ui = ui;
    const app = (this.app = ui.app);
    this.car = { ...DEFAULT_CAR, ...app.profile.car };
    this.room = new Showroom(app.renderer);
    this.room.setCar(this.car);
    ui.garage = this;
    this.tab = 'body';
    this.panel = h('div.garage-panel-body');
    this.tabsEl = h('div.garage-tabs');
    this.nameInput = h('input.name-input', { type: 'text', maxLength: 16, placeholder: 'Driver name', value: app.profile.name || '' });
    this.nameInput.addEventListener('input', () => { app.profile.name = this.nameInput.value.slice(0, 16); app.saveProfile(); });
    this.view = h('div.garage-view');
    this.el = h('div.screen.garage-screen',
      h('div.garage-left',
        h('div.screen-head',
          button([icon('back')], () => this.back(), 'icon-btn'),
          h('h1', 'Garage')),
        h('div.garage-name', h('label', 'Driver'), this.nameInput),
        this.tabsEl,
        this.panel,
        h('div.garage-actions',
          button('Randomize', () => { this.set(randomBotCar(Math.random)); }, ''),
          button('Done', () => this.back(), 'primary')),
      ),
      this.view,
    );
    // drag to spin the car
    this.view.addEventListener('pointerdown', (e) => { this.room.drag = { x: e.clientX, a: this.room.angle }; this.view.setPointerCapture(e.pointerId); });
    this.view.addEventListener('pointermove', (e) => { if (this.room.drag) this.room.angle = this.room.drag.a + (e.clientX - this.room.drag.x) * 0.01; });
    this.view.addEventListener('pointerup', () => { this.room.drag = null; });
    this.view.addEventListener('wheel', (e) => { this.room.dist = Math.max(5.5, Math.min(12, this.room.dist + e.deltaY * 0.004)); e.preventDefault(); }, { passive: false });
    this.renderTabs();
    this.renderPanel();
  }

  back() {
    this.app.audio.play('back');
    this.app.closeGarage();
  }

  set(patch) {
    Object.assign(this.car, patch);
    this.app.profile.car = { ...this.car };
    this.app.saveProfile();
    this.room.setCar(this.car);
    this.app.audio.play('click');
    this.renderPanel();
  }

  renderTabs() {
    clear(this.tabsEl);
    for (const [k, label] of TABS) {
      this.tabsEl.append(h('button.gtab' + (k === this.tab ? '.on' : ''), { type: 'button', onclick: () => { this.tab = k; this.renderTabs(); this.renderPanel(); this.app.audio.play('click'); } }, label));
    }
  }

  swatches(key, list = SWATCHES) {
    const cur = this.car[key];
    const wrap = h('div.swatches');
    for (const c of list) {
      if (c === 'none') { wrap.append(h('button.swatch.none' + (cur === 'none' ? '.on' : ''), { type: 'button', title: 'Off', onclick: () => this.set({ [key]: 'none' }) }, '∅')); continue; }
      wrap.append(h('button.swatch' + (c.toLowerCase() === String(cur).toLowerCase() ? '.on' : ''), { type: 'button', style: { background: c }, title: c, onclick: () => this.set({ [key]: c }) }));
    }
    const picker = h('input.picker', { type: 'color', value: cur && cur !== 'none' ? cur : '#ffffff', title: 'Custom colour' });
    picker.addEventListener('change', () => this.set({ [key]: picker.value }));
    wrap.append(h('label.swatch.custom', { title: 'Custom colour' }, '+', picker));
    return wrap;
  }

  options(key, items) {
    const wrap = h('div.opt-grid');
    for (const [id, label, sub] of items) {
      wrap.append(h('button.opt-card' + (this.car[key] === id ? '.on' : ''), { type: 'button', onclick: () => this.set({ [key]: id }) }, h('b', label), sub ? h('span', sub) : null));
    }
    return wrap;
  }

  renderPanel() {
    const p = this.panel;
    clear(p);
    const sec = (title, ...kids) => h('div.gsec', h('h3', title), ...kids);
    switch (this.tab) {
      case 'body':
        p.append(sec('Body', this.options('body', BODY_IDS.map((id) => [id, BODIES[id].name, BODIES[id].blurb]))),
          h('p.note', 'Every body shares the same handling, so races are won by the driver.'));
        break;
      case 'paint':
        p.append(sec('Main colour', this.swatches('paint')),
          sec('Accent colour', this.swatches('accent')),
          sec('Finish', this.options('finish', Object.entries(FINISHES).map(([id, f]) => [id, f.name]))));
        break;
      case 'livery': {
        const num = h('input.num-input', { type: 'number', min: 0, max: 99, value: this.car.number });
        num.addEventListener('change', () => this.set({ number: Math.max(0, Math.min(99, parseInt(num.value, 10) || 0)) }));
        p.append(sec('Pattern', this.options('livery', LIVERIES.map((l) => [l.id, l.name]))),
          sec('Race number', h('div.row',
            h('button.toggle' + (this.car.showNumber ? '.on' : ''), { type: 'button', onclick: () => this.set({ showNumber: !this.car.showNumber }) }, this.car.showNumber ? 'Shown' : 'Hidden'),
            num)),
          sec('Trim colour', this.swatches('detail', ['#15171c', '#2b2f36', '#5d6570', '#c9ced6', '#f4f4f4', '#6b4a2a'])));
        break;
      }
      case 'wheels':
        p.append(sec('Rims', this.options('rim', RIMS.map((r) => [r, RIM_NAMES[r]]))), sec('Rim colour', this.swatches('rimColor')));
        break;
      case 'aero':
        p.append(sec('Spoiler', this.options('spoiler', SPOILERS.map((s) => [s, SPOILER_NAMES[s]]))),
          BODIES[this.car.body]?.open ? h('p.note', 'Open-wheel bodies carry their own wings.') : null);
        break;
      case 'extras':
        p.append(sec('Underglow', this.swatches('underglow', GLOWS)),
          sec('Boost flame', this.swatches('trail', GLOWS.slice(1))),
          sec('Window tint', this.options('tint', Object.keys(TINTS).map((t) => [t, t[0].toUpperCase() + t.slice(1)]))));
        break;
      case 'presets': {
        const wrap = h('div.opt-grid');
        for (const pr of PRESETS) wrap.append(h('button.opt-card.preset', { type: 'button', style: { '--c1': pr.car.paint, '--c2': pr.car.accent }, onclick: () => this.set({ ...DEFAULT_CAR, ...pr.car }) }, h('i.pchip'), h('b', pr.name)));
        p.append(sec('Presets', wrap));
        break;
      }
      default: break;
    }
    this.room.boostPreview = this.tab === 'extras';
  }

  update(dt) {
    this.room.update(dt, this.view.getBoundingClientRect());
  }

  destroy() {
    this.room.dispose();
    this.ui.garage = null;
  }
}
