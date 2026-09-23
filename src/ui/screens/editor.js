// Track Builder: lay a track out piece by piece over a live 3D preview.
// Circuits close themselves (see track/custom.js), every change is checked,
// and the track saves itself to this browser's library as you go. From here
// you can test drive it, let the AI prove it (and set its medal times), and
// share it as a code or a file.
import * as THREE from 'three';
import { h, icon, clear } from '../dom.js';
import { button } from '../ui.js';
import { buildTrackGeometry } from '../../track/geometry.js';
import { buildTrackView } from '../../render/trackview.js';
import { buildSky, followSky } from '../../render/sky.js';
import { THEMES } from '../../track/themes.js';
import { drawTrack, mapTransform } from '../trackmap.js';
import { formatTime } from '../../util/math.js';
import {
  defaultPiece, pieceString, pieceFromString, clampPiece, finalize, sanitize, checkDef, buildDef, closingPieces,
  templateDef, library, saveToLibrary, deleteFromLibrary, encodeShare, decodeShare, fileName, RANGE, SURFACES, LIMITS,
} from '../../track/custom.js';

import { Verifier, medalsFromTime } from '../../game/verify.js';
import { trackThumb } from './play.js';

const TYPE_NAME = { S: 'Straight', L: 'Left turn', R: 'Right turn', K: 'Ramp', J: 'Gap', LOOP: 'Loop' };
const GLYPH = { S: '▬', L: '↰', R: '↱', K: '◢', J: '⋯', LOOP: '◯' };
const DIFF = ['Easy', 'Medium', 'Hard', 'Expert'];

// ---- 3D preview -------------------------------------------------------------------
class EditorView {
  constructor(renderer) {
    this.r = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 16 / 9, 1, 9000);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x445544, 1.4);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.position.set(0.4, 0.8, 0.3);
    this.scene.add(this.hemi, this.sun);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.orbit = { yaw: 0.7, pitch: 0.95, dist: 600, target: new THREE.Vector3() };
    this.goal = null; // camera glide target { target, dist }
    this.themeId = null;
    this.fog = new THREE.Fog(0xffffff, 500, 3000);
    this.scene.fog = this.fog;
  }

  setTheme(id) {
    if (this.themeId === id) return;
    this.themeId = id;
    const th = THEMES[id] || THEMES.meadow;
    this.theme = th;
    if (this.sky) { this.scene.remove(this.sky); disposeTree(this.sky); }
    this.sky = buildSky({ ...th, mountains: null }, 3);
    this.scene.add(this.sky);
    this.hemi.color.set(th.hemi.sky); this.hemi.groundColor.set(th.hemi.ground);
    this.hemi.intensity = th.hemi.intensity * (th.night ? 1.9 : 1.25);
    this.sun.color.set(th.sun.color); this.sun.intensity = th.sun.intensity * (th.night ? 1.6 : 1);
    this.sun.position.set(...th.sun.dir);
    this.scene.background = new THREE.Color(th.sky.horizon);
    this.fog.color.set(th.fog.color);
    if (this.ground) { this.scene.remove(this.ground); disposeTree(this.ground); this.ground = null; }
    if (th.ground !== 'void') {
      const wet = th.ground === 'water' || th.ground === 'lava';
      const col = wet ? th.waterColor ?? (th.ground === 'lava' ? 0xff5a1a : 0x1fb5c9) : th.groundColors?.[0] ?? 0x6fae45;
      const mat = wet && th.ground === 'lava' ? new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(1.4) }) : new THREE.MeshLambertMaterial({ color: col });
      this.ground = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), mat);
      this.ground.rotation.x = -Math.PI / 2;
      this.ground.position.y = wet ? -2.2 : -0.05;
      this.scene.add(this.ground);
    }
  }

  // rebuild the road; sel = selected piece, userCount = pieces before the closing section
  setTrack(track, sel, userCount, marks = []) {
    this._clear();
    if (!track) return;
    const geo = buildTrackGeometry(track, this.theme);
    this.road = buildTrackView(geo, this.theme);
    this.group.add(this.road);
    this.track = track;
    this.userCount = userCount;
    this.bounds = track.bounds;
    // the closing section, tinted
    if (track.closed && userCount < track.pieces.length) {
      const from = track.pieceStart[userCount], to = track.samples.length;
      const m = ribbon(track, from, to, 0xffd23c, 0.22);
      if (m) this.group.add(m);
    }
    for (const p of marks) {
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 0.2, 14, 6), new THREE.MeshBasicMaterial({ color: 0xff3d3d }));
      pin.position.copy(p).add(new THREE.Vector3(0, 8, 0));
      this.group.add(pin);
    }
    this.select(sel);
  }

  select(sel) {
    if (this.hl) { this.group.remove(this.hl); disposeTree(this.hl); this.hl = null; }
    const t = this.track;
    if (!t || sel < 0 || sel >= t.pieces.length) return;
    const from = t.pieceStart[sel], to = sel + 1 < t.pieceStart.length ? t.pieceStart[sel + 1] : t.samples.length;
    this.hl = ribbon(t, from, Math.max(from + 2, to + 1), 0x39e6ff, 0.45);
    if (this.hl) this.group.add(this.hl);
  }

  // the middle of a piece (for focusing the camera on it)
  pieceCenter(k) {
    const t = this.track;
    if (!t) return null;
    const from = t.pieceStart[k], to = k + 1 < t.pieceStart.length ? t.pieceStart[k + 1] : t.samples.length;
    const sm = t.samples[Math.min(t.samples.length - 1, Math.floor((from + to) / 2))];
    return sm ? sm.p.clone() : null;
  }

  frame(instant = false) {
    const b = this.bounds;
    if (!b) return;
    const target = new THREE.Vector3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
    const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 120);
    this.glide(target, size * 1.5 + 60, instant);
  }

  glide(target, dist, instant = false) {
    if (instant) { this.orbit.target.copy(target); this.orbit.dist = dist; this.goal = null; return; }
    this.goal = { target: target.clone(), dist };
  }

  _clear() {
    for (const o of [...this.group.children]) { this.group.remove(o); disposeTree(o); }
    this.hl = null;
    this.road = null;
  }

  update(dt, rect) {
    const o = this.orbit;
    if (this.goal) {
      const k = 1 - Math.exp(-dt * 6);
      o.target.lerp(this.goal.target, k);
      o.dist += (this.goal.dist - o.dist) * k;
      if (o.target.distanceTo(this.goal.target) < 0.5 && Math.abs(o.dist - this.goal.dist) < 1) this.goal = null;
    }
    const r = this.r.renderer;
    const W = r.domElement.clientWidth, H = r.domElement.clientHeight;
    const cam = this.camera;
    cam.aspect = W / Math.max(1, H);
    // centre the view on the free area between the side panels
    const cx = rect ? (rect.left + rect.width / 2) / W : 0.5, cy = rect ? (rect.top + rect.height / 2) / H : 0.5;
    cam.setViewOffset(W, H, (0.5 - cx) * W, (0.5 - cy) * H, W, H);
    const cp = Math.cos(o.pitch);
    cam.position.set(o.target.x + Math.sin(o.yaw) * cp * o.dist, o.target.y + Math.sin(o.pitch) * o.dist, o.target.z + Math.cos(o.yaw) * cp * o.dist);
    cam.lookAt(o.target);
    cam.near = Math.max(0.5, o.dist / 400);
    cam.far = Math.max(4000, o.dist * 8);
    cam.updateProjectionMatrix();
    if (this.sky) followSky(this.sky, cam.position);
    this.fog.near = o.dist * 1.2;
    this.fog.far = o.dist * 6 + 1500;
    r.toneMappingExposure = this.theme?.exposure ?? 1;
    r.render(this.scene, cam);
  }

  dispose() {
    this._clear();
    disposeTree(this.scene);
  }
}

function disposeTree(o) {
  o.traverse?.((c) => {
    c.geometry?.dispose();
    if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => { m.map?.dispose(); m.dispose(); });
  });
}

// a see-through strip over samples [from, to)
function ribbon(track, from, to, color, opacity) {
  const S = track.samples, n = S.length;
  const pos = [];
  for (let i = from; i < to - 1; i++) {
    const a = S[i % n], b = S[(i + 1) % n];
    if (!a || !b) continue;
    const pa = (sm, side) => sm.p.clone().addScaledVector(sm.l, side * (sm.hw + 0.6)).addScaledVector(sm.n, 0.35);
    const a0 = pa(a, 1), a1 = pa(a, -1), b0 = pa(b, 1), b1 = pa(b, -1);
    pos.push(a0.x, a0.y, a0.z, a1.x, a1.y, a1.z, b1.x, b1.y, b1.z, a0.x, a0.y, a0.z, b1.x, b1.y, b1.z, b0.x, b0.y, b0.z);
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
  m.renderOrder = 5;
  return m;
}

// ---- the screen -----------------------------------------------------------------------
export class EditorScreen {
  constructor(ui, data = {}) {
    this.ui = ui;
    const app = (this.app = ui.app);
    ui.editor = this;
    this.view = new EditorView(app.renderer);
    // what we're editing: last session's track, a given one, or the newest saved
    const st = data.def ? { def: data.def, slot: data.slot } : app.editorState || null;
    let def = st?.def;
    let slot = st?.slot;
    if (!def) { const lib = library(); if (lib.length) { def = lib[0]; slot = lib[0].slot; } }
    if (!def) { const saved = saveToLibrary(finalize(templateDef(this.defaultName()))); def = saved; slot = saved.slot; }
    this.slot = slot;
    this.load(def);
    this.sel = st?.sel ?? -1;
    this.history = [];
    this.future = [];

    this.nameInput = h('input.name-input.ed-name', { type: 'text', maxLength: LIMITS.name, value: this.def.name, placeholder: 'Track name', spellcheck: false });
    this.nameInput.addEventListener('input', () => { this.def.name = this.nameInput.value.slice(0, LIMITS.name); this.touch(false); });
    this.undoBtn = button([icon('undo')], () => this.undo(), 'icon-btn small', { title: 'Undo (Ctrl+Z)' });
    this.redoBtn = button([icon('redo')], () => this.redo(), 'icon-btn small', { title: 'Redo (Ctrl+Y)' });
    this.savedEl = h('span.ed-saved', 'Saved');
    this.tab = this.sel >= 0 ? 'piece' : 'track';
    this.tabsEl = h('div.ed-tabs');
    this.listEl = h('div.ed-list');
    this.inspEl = h('div.ed-inspector');
    this.statusEl = h('div.ed-status');
    this.aiEl = h('div.ed-ai');
    this.map = h('canvas.ed-map', { width: 240, height: 240 });
    this.viewEl = h('div.ed-view', this.map);
    this.el = h('div.screen.editor-screen',
      h('div.ed-top',
        button([icon('back')], () => this.back(), 'icon-btn', { title: 'Back to the menu' }),
        h('h1', 'Track Builder'),
        this.nameInput,
        this.undoBtn, this.redoBtn, this.savedEl,
        h('div.ed-actions',
          button([icon('folder'), h('span', 'My tracks')], () => this.openLibrary(), 'small'),
          button([icon('plus'), h('span', 'New')], () => this.newTrack(), 'small'),
          button([icon('upload'), h('span', 'Import')], () => this.openImport(), 'small'),
          button([icon('share'), h('span', 'Share')], () => this.openExport(), 'small'),
          button([icon('flag'), h('span', 'Test drive')], () => this.testDrive(), 'primary small'))),
      h('div.ed-left.panel', h('h3', 'Pieces'), this.listEl, this.palette()),
      this.viewEl,
      h('div.ed-right.panel', this.tabsEl, this.inspEl),
      h('div.ed-bottom', this.statusEl, this.aiEl));
    this.bindView();
    this._key = (e) => this.onKey(e);
    document.addEventListener('keydown', this._key);
    this.renderList();
    this.renderInspector();
    this.rebuild(true);
    this.renderAI();
  }

  defaultName() { return `${this.app.playerName()}'s Track`.slice(0, LIMITS.name); }

  load(def) {
    this.def = { name: def.name, author: def.author, theme: def.theme, laps: def.laps, width: def.width ?? 14, walls: def.walls ?? 'turns', difficulty: def.difficulty ?? 1, pieces: def.pieces.slice(), medals: def.medals };
    this.model = this.def.pieces.map((s) => pieceFromString(s, this.def));
  }

  // the current definition, finalized (id etc.)
  current() {
    this.def.pieces = this.model.map(pieceString);
    return finalize({ ...this.def, author: this.def.author || this.app.playerName() });
  }

  // ---- change tracking -------------------------------------------------------------
  snapshot() { return JSON.stringify({ def: { ...this.def, pieces: this.model.map(pieceString) }, sel: this.sel }); }

  // call before a change that should be undoable
  mark() {
    const s = this.snapshot();
    if (this.history[this.history.length - 1] !== s) this.history.push(s);
    if (this.history.length > 120) this.history.shift();
    this.future = [];
  }

  // after any change; layout=false for name-only edits
  touch(layout = true) {
    if (layout) delete this.def.medals; // AI medal times belong to the old layout
    clearTimeout(this._saveT);
    this.savedEl.textContent = 'Saving…';
    this._saveT = setTimeout(() => this.save(), 600);
    if (layout) { clearTimeout(this._buildT); this._buildT = setTimeout(() => this.rebuild(), 90); }
    this.updateUndo();
  }

  save() {
    const saved = saveToLibrary({ ...this.current(), slot: this.slot });
    this.slot = saved.slot;
    this.app.editorState = { def: this.current(), slot: this.slot, sel: this.sel };
    this.savedEl.textContent = 'Saved';
  }

  undo() {
    if (!this.history.length) return;
    this.future.push(this.snapshot());
    this.restore(this.history.pop());
  }

  redo() {
    if (!this.future.length) return;
    this.history.push(this.snapshot());
    this.restore(this.future.pop());
  }

  restore(s) {
    const { def, sel } = JSON.parse(s);
    this.load(def);
    this.sel = sel;
    this.nameInput.value = this.def.name;
    this.renderList(); this.renderInspector();
    this.touch();
  }

  updateUndo() {
    this.undoBtn.disabled = !this.history.length;
    this.redoBtn.disabled = !this.future.length;
  }

  // ---- building + checks -------------------------------------------------------------
  rebuild(frame = false) {
    const def = this.current();
    const res = checkDef(def);
    this.check = res;
    this.view.setTheme(def.theme);
    this.view.setTrack(res.track, this.sel, this.model.length, res.marks || []);
    if (frame) this.view.frame(true);
    this.drawMap();
    this.renderStatus();
    this.renderList();
  }

  renderStatus() {
    const { track, errors, warnings } = this.check;
    clear(this.statusEl);
    const km = track ? `${(track.length / 1000).toFixed(2)} km` : '--';
    const kind = this.def.laps > 0 ? `Circuit · ${this.def.laps} laps` : 'Sprint';
    this.statusEl.append(h('div.ed-facts', h('b', km), h('span', kind), h('span', `${this.model.length} pieces`), h('span', `${track?.checkpoints.length ?? 0} checkpoints`)));
    const list = h('div.ed-issues');
    for (const e of errors) list.append(h('div.issue.err', e));
    for (const w of warnings.slice(0, 4)) list.append(h('button.issue.warn', { type: 'button', onclick: () => this.select(w.piece, true) }, w.text));
    if (!errors.length && !warnings.length) list.append(h('div.issue.ok', track?.closed ? 'Ready to race. The circuit closes itself - the gold strip is added automatically.' : 'Ready to race.'));
    this.statusEl.append(list);
  }

  // ---- track settings (right panel, Track tab) -------------------------------------------
  renderSettings(el) {
    const d = this.def;
    const themeSel = h('select.track-select', ...Object.entries(THEMES).map(([id, t]) => h('option', { value: id, selected: id === d.theme }, t.name)));
    themeSel.addEventListener('change', () => { this.mark(); d.theme = themeSel.value; this.touch(); });
    const seg = (vals, cur, set) => h('div.choice', ...vals.map(([v, label]) => h('button' + (v === cur ? '.on' : ''), { type: 'button', onclick: () => { if (v === cur) return; this.mark(); set(v); this.renderInspector(); this.touch(); } }, label)));
    const lapStep = h('div.stepper',
      h('button', { type: 'button', onclick: () => { if (d.laps > 1) { this.mark(); d.laps--; this.renderInspector(); this.touch(); } } }, '−'),
      h('b', String(d.laps)),
      h('button', { type: 'button', onclick: () => { if (d.laps < 9) { this.mark(); d.laps++; this.renderInspector(); this.touch(); } } }, '+'));
    const diff = h('select.track-select', ...DIFF.map((x, i) => h('option', { value: i, selected: i === d.difficulty }, x)));
    diff.addEventListener('change', () => { this.mark(); d.difficulty = +diff.value; this.touch(false); });
    el.append(
      h('div.ed-sec',
        row('Scenery', themeSel),
        row('Type', seg([['circuit', 'Circuit'], ['sprint', 'Sprint']], d.laps > 0 ? 'circuit' : 'sprint', (v) => { d.laps = v === 'circuit' ? 3 : 0; })),
        d.laps > 0 ? row('Laps', lapStep) : null,
        row('Road width', this.slider(d.width, RANGE.w[0], RANGE.w[1], 1, (v) => `${v} m`, (v) => { d.width = v; })),
        row('Barriers', seg([['turns', 'Corners'], ['all', 'All'], ['none', 'None']], d.walls, (v) => { d.walls = v; })),
        row('Difficulty', diff)),
      h('p.note', 'Circuits close themselves: the gold section at the end is added automatically (press Keep in the piece list to edit it). Sprints finish at the end of the last piece.'));
  }

  renderList() {
    clear(this.listEl);
    this.model.forEach((p, k) => {
      const badges = [];
      if (p.cp) badges.push(h('i.bdg.cp', 'CP'));
      if (p.boost) badges.push(h('i.bdg.boost', '⚡'));
      if (p.surface) badges.push(h('i.bdg.surf', p.surface));
      if (p.tunnel) badges.push(h('i.bdg', 'tunnel'));
      const row2 = h('button.pc-row' + (k === this.sel ? '.sel' : '') + (k === 0 ? '.start' : ''), {
        type: 'button', onclick: () => this.select(k), ondblclick: () => this.select(k, true), title: 'Double-click to fly to it',
      }, h('span.pc-n', String(k + 1)), h('span.pc-g', GLYPH[p.type]), h('span.pc-d', k === 0 ? 'Start straight · ' + describe(p) : describe(p)), ...badges);
      this.listEl.append(row2);
    });
    const close = this.def.laps > 0 ? closingPieces(this.current()) : [];
    if (close.length) {
      this.listEl.append(h('div.pc-close', h('span', 'Closing section (automatic): ' + close.map((p) => describe(p)).join(' · ')),
        button('Keep', () => this.bakeClosing(), 'tiny', { title: 'Turn the closing section into normal pieces you can edit' })));
    }
    this.listEl.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }

  palette() {
    const add = (label, ic, fn, tip) => h('button.pal-btn', { type: 'button', title: tip, onclick: fn }, h('span.pc-g', ic), label);
    return h('div.ed-palette',
      h('h3', 'Add after selected'),
      h('div.pal-grid',
        add('Straight', GLYPH.S, () => this.insert([defaultPiece('S')]), 'A straight'),
        add('Left', GLYPH.L, () => this.insert([defaultPiece('L')]), 'A left-hand corner'),
        add('Right', GLYPH.R, () => this.insert([defaultPiece('R')]), 'A right-hand corner'),
        add('Jump', GLYPH.K, () => this.insert([{ ...defaultPiece('S'), len: 70 }, defaultPiece('K'), defaultPiece('J'), { ...defaultPiece('S'), len: 70 }]), 'Run-up, ramp, gap and landing'),
        add('Loop', GLYPH.LOOP, () => this.insert([{ ...defaultPiece('S'), len: 70, boost: true }, defaultPiece('LOOP'), { ...defaultPiece('S'), len: 40 }]), 'Run-up with a boost pad, the loop, and a straight out'),
        add('Hill', '⌒', () => this.insert([{ ...defaultPiece('S'), dh: 6 }, { ...defaultPiece('S'), dh: -6 }]), 'Up and back down')));
  }

  // ---- right panel: Piece | Track tabs -------------------------------------------------------
  renderInspector() {
    const el = this.inspEl;
    clear(el);
    clear(this.tabsEl);
    for (const [k2, label] of [['piece', 'Piece'], ['track', 'Track']]) {
      this.tabsEl.append(h('button.tab' + (this.tab === k2 ? '.on' : ''), { type: 'button', onclick: () => { this.tab = k2; this.renderInspector(); } }, label));
    }
    if (this.tab === 'track') { this.renderSettings(el); return; }
    const k = this.sel;
    const p = this.model[k];
    if (!p) {
      el.append(h('h3', 'Piece'), h('p.note', 'Select a piece in the list or click the map to edit it. New pieces go after the one you select.'),
        h('p.note', 'Tips: circuits close themselves with the gold section. Road that crosses itself needs a hill (rise/fall) so one part bridges over the other. Give ramps a long straight run-up.'));
      return;
    }
    const set = (patch) => { this.mark(); Object.assign(p, patch); this.model[k] = clampPiece(p); this.touch(); this.renderList(); };
    const live = (field) => (v) => { p[field] = v; this.model[k] = clampPiece(p); this.touch(); this.renderListRow(k); };
    const sl = (label, field, lo, hi, step, fmt) => row(label, this.slider(p[field] ?? 0, lo, hi, step, fmt, live(field)));
    el.append(h('div.insp-head', h('span.pc-g', GLYPH[p.type]), h('h3', `${k + 1}. ${TYPE_NAME[p.type]}`),
      h('div.insp-tools',
        button('▲', () => this.move(-1), 'icon-btn tiny', { title: 'Move up', disabled: k <= 1 }),
        button('▼', () => this.move(1), 'icon-btn tiny', { title: 'Move down', disabled: k === 0 || k >= this.model.length - 1 }),
        button([icon('copy')], () => this.duplicate(), 'icon-btn tiny', { title: 'Duplicate', disabled: k === 0 }),
        button([icon('trash')], () => this.remove(), 'icon-btn tiny danger', { title: 'Delete (Del)', disabled: k === 0 }))));
    if (p.type === 'L' || p.type === 'R') {
      el.append(row('Direction', h('div.choice', ...['L', 'R'].map((t) => h('button' + (p.type === t ? '.on' : ''), { type: 'button', onclick: () => set({ type: t }) }, t === 'L' ? 'Left' : 'Right')))));
      el.append(sl('Angle', 'deg', 5, 360, 5, (v) => `${v}°`), sl('Radius', 'r', RANGE.r[0], RANGE.r[1], 1, (v) => `${v} m`), sl('Banking', 'bank', RANGE.bank[0], RANGE.bank[1], 1, (v) => `${v}°`));
    }
    if (p.type === 'S') el.append(sl('Length', 'len', k === 0 ? 40 : RANGE.len.S[0], RANGE.len.S[1], 5, (v) => `${v} m`));
    if (p.type === 'K') el.append(sl('Length', 'len', RANGE.len.K[0], RANGE.len.K[1], 1, (v) => `${v} m`), sl('Lip angle', 'lip', RANGE.lip[0], RANGE.lip[1], 1, (v) => `${v}°`));
    if (p.type === 'J') el.append(sl('Gap', 'len', RANGE.len.J[0], RANGE.len.J[1], 1, (v) => `${v} m`), sl('Landing height', 'dh', RANGE.dh.J[0], RANGE.dh.J[1], 1, (v) => `${v > 0 ? '+' : ''}${v} m`));
    if (p.type === 'LOOP') el.append(sl('Radius', 'loopR', RANGE.loopR[0], RANGE.loopR[1], 1, (v) => `${v} m`), sl('Side shift', 'off', RANGE.off[0], RANGE.off[1], 1, (v) => (v === 0 ? '0 m' : v > 0 ? `${v} m right` : `${-v} m left`)));
    if (p.type === 'S' || p.type === 'L' || p.type === 'R') el.append(sl('Rise / fall', 'dh', RANGE.dh.S[0], RANGE.dh.S[1], 1, (v) => `${v > 0 ? '+' : ''}${v} m`));
    if (p.type !== 'J') {
      const w = p.w;
      el.append(row('Road width', h('div.row',
        h('button.toggle' + (w ? '.on' : ''), { type: 'button', onclick: () => set({ w: w ? null : this.def.width }) }, w ? 'Custom' : 'Same'),
        w ? this.slider(w, RANGE.w[0], RANGE.w[1], 1, (v) => `${v} m`, live('w')) : null)));
    }
    const tog = (label, field, tip) => h('button.toggle' + (p[field] ? '.on' : ''), { type: 'button', title: tip, onclick: () => set({ [field]: !p[field] }) }, label);
    el.append(row('Extras', h('div.row.wrap',
      tog('Checkpoint', 'cp', 'A checkpoint gate at the end of this piece'),
      p.type !== 'J' ? tog('Boost pad', 'boost', 'A boost pad halfway along') : null,
      p.type !== 'J' ? tog('Tunnel', 'tunnel', 'A tunnel over this piece') : null)));
    if (p.type !== 'J') {
      const surf = h('select.track-select', ...SURFACES.map((s) => h('option', { value: s, selected: (p.surface || 'asphalt') === s }, s[0].toUpperCase() + s.slice(1))));
      surf.addEventListener('change', () => set({ surface: surf.value }));
      const walls = h('select.track-select', ...[['auto', 'Track default'], ['both', 'Both sides'], ['left', 'Left only'], ['right', 'Right only'], ['none', 'None']].map(([v, l]) => h('option', { value: v, selected: (p.walls || 'auto') === v }, l)));
      walls.addEventListener('change', () => set({ walls: walls.value }));
      el.append(row('Surface', surf), row('Barriers', walls));
    }
    el.append(h('div.insp-code', h('code', pieceString(p))));
  }

  renderListRow(k) {
    const r2 = this.listEl.children[k];
    const d = r2?.querySelector('.pc-d');
    if (d) d.textContent = (k === 0 ? 'Start straight · ' : '') + describe(this.model[k]);
    this.inspEl.querySelector('.insp-code code')?.replaceChildren(pieceString(this.model[k]));
  }

  // range slider with a value label; set(v) runs live while dragging, one undo step per drag
  slider(value, lo, hi, step, fmt, set) {
    const out = h('b', fmt(value));
    const inp = h('input.slider', { type: 'range', min: lo, max: hi, step, value });
    let dragging = false;
    inp.addEventListener('pointerdown', () => { if (!dragging) { dragging = true; this.mark(); } });
    inp.addEventListener('keydown', () => { if (!dragging) { dragging = true; this.mark(); } });
    inp.addEventListener('input', () => { const v = parseFloat(inp.value); out.textContent = fmt(v); set(v); });
    inp.addEventListener('change', () => { dragging = false; this.touch(); });
    return h('div.slider-row', inp, out);
  }

  // ---- editing operations --------------------------------------------------------------
  select(k, fly = false) {
    this.sel = k;
    this.tab = 'piece';
    this.view.select(k);
    this.renderList();
    this.renderInspector();
    this.drawMap();
    if (fly) { const c = this.view.pieceCenter(k); if (c) this.view.glide(c, Math.max(90, Math.min(260, this.view.orbit.dist))); }
    if (this.app.editorState) this.app.editorState.sel = k;
  }

  insert(pieces) {
    if (this.model.length + pieces.length > LIMITS.pieces) { this.ui.toast(`Tracks can have up to ${LIMITS.pieces} pieces.`, 'err'); return; }
    this.mark();
    const at = this.sel >= 0 ? this.sel + 1 : this.model.length;
    this.model.splice(at, 0, ...pieces.map(clampPiece));
    this.sel = at + pieces.length - 1;
    this.app.audio.play('click');
    this.touch();
    this.renderList();
    this.renderInspector();
  }

  remove() {
    const k = this.sel;
    if (k <= 0) return;
    this.mark();
    this.model.splice(k, 1);
    this.sel = Math.min(k, this.model.length - 1);
    this.touch(); this.renderList(); this.renderInspector();
  }

  duplicate() {
    const k = this.sel;
    if (k <= 0) return;
    this.insert([{ ...this.model[k] }]);
  }

  move(dir) {
    const k = this.sel, j = k + dir;
    if (k <= 0 || j <= 0 || j >= this.model.length) return;
    this.mark();
    [this.model[k], this.model[j]] = [this.model[j], this.model[k]];
    this.sel = j;
    this.touch(); this.renderList(); this.renderInspector();
  }

  bakeClosing() {
    const close = closingPieces(this.current());
    if (!close.length) return;
    this.mark();
    this.model.push(...close.map((p) => clampPiece({ ...p, deg: Math.round(p.deg * 10) / 10, len: p.len != null ? Math.round(p.len * 10) / 10 : p.len })));
    this.touch(); this.renderList();
    this.ui.toast('Closing section added as pieces - a new small one closes any rounding left over.');
  }

  onKey(e) {
    if (this.ui.current !== 'editor') return;
    if (this.modal) { if (e.key === 'Escape') this.modalClose(); return; }
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' && document.activeElement.type !== 'range' || tag === 'TEXTAREA' || tag === 'SELECT';
    if ((e.ctrlKey || e.metaKey) && !typing) {
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); }
      else if (e.key === 'y' || (e.key === 'z' && e.shiftKey) || e.key === 'Z') { e.preventDefault(); this.redo(); }
      return;
    }
    if (typing) return;
    if (e.key === 'Delete') { e.preventDefault(); this.remove(); }
    else if (e.key === 'ArrowDown' && this.sel < this.model.length - 1) { e.preventDefault(); e.stopPropagation(); this.select(this.sel + 1); }
    else if (e.key === 'ArrowUp' && this.sel > 0) { e.preventDefault(); e.stopPropagation(); this.select(this.sel - 1); }
    else if (e.key === 'f' || e.key === 'F') this.view.frame();
  }

  // ---- map + camera controls --------------------------------------------------------------
  drawMap() {
    const c = this.map, ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    const t = this.check?.track;
    if (!t) return;
    ctx.fillStyle = 'rgba(8,12,22,0.55)';
    ctx.fillRect(0, 0, c.width, c.height);
    const n = this.model.length;
    drawTrack(ctx, t, c.width, c.height, { pad: 14, width: 4, color: (k, sm) => (sm.piece === this.sel ? '#39e6ff' : sm.piece >= n ? '#ffd23c' : `hsl(${205 - k * 30}, 25%, ${72 + k * 22}%)`) });
    this.mapT = mapTransform(t, c.width, c.height, 14);
  }

  bindView() {
    const v = this.viewEl, o = this.view.orbit;
    let drag = null;
    v.addEventListener('contextmenu', (e) => e.preventDefault());
    v.addEventListener('pointerdown', (e) => {
      if (e.target === this.map) return;
      drag = { x: e.clientX, y: e.clientY, yaw: o.yaw, pitch: o.pitch, pan: e.button === 2 || e.shiftKey, t: o.target.clone(), moved: false };
      v.setPointerCapture(e.pointerId);
      this.view.goal = null;
    });
    v.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.pan) {
        const k = o.dist / 700;
        const right = new THREE.Vector3(Math.cos(o.yaw), 0, -Math.sin(o.yaw));
        const fwd = new THREE.Vector3(-Math.sin(o.yaw), 0, -Math.cos(o.yaw));
        o.target.copy(drag.t).addScaledVector(right, -dx * k).addScaledVector(fwd, dy * k);
      } else {
        o.yaw = drag.yaw - dx * 0.006;
        o.pitch = Math.max(0.12, Math.min(1.5, drag.pitch + dy * 0.005));
      }
    });
    v.addEventListener('pointerup', () => { drag = null; });
    v.addEventListener('wheel', (e) => { e.preventDefault(); this.view.goal = null; o.dist = Math.max(40, Math.min(4000, o.dist * Math.exp(e.deltaY * 0.0012))); }, { passive: false });
    // click the map: select the piece under the pointer
    this.map.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const t = this.check?.track, T = this.mapT;
      if (!t || !T) return;
      const rect = this.map.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / rect.width) * this.map.width, my = ((e.clientY - rect.top) / rect.height) * this.map.height;
      let best = -1, bd = 18 * 18;
      for (const sm of t.samples) {
        const dx = T.x(sm.p.x) - mx, dy = T.y(sm.p.z) - my;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = sm.piece; }
      }
      if (best >= 0 && best < this.model.length) this.select(best, true);
    });
  }

  // ---- AI test --------------------------------------------------------------------------
  renderAI() {
    const el = this.aiEl;
    clear(el);
    const m = this.def.medals;
    if (this.verifier) {
      el.append(h('div.ai-run', h('span', 'AI driving…'), h('div.ai-bar', h('i', { style: { transform: `scaleX(${this.verifier.progress.toFixed(3)})` } })), button('Stop', () => { this.verifier = null; this.renderAI(); }, 'tiny ghost')));
      return;
    }
    el.append(button([icon('robot'), h('span', m ? 'AI test again' : 'AI test')], () => this.runAI(), 'small', { title: 'An AI driver races the track to prove it can be finished - and sets medal times' }));
    if (m) el.append(h('div.ai-medals', h('span', 'Medals'), ...['author', 'gold', 'silver', 'bronze'].map((k) => h('span.tdm', h('span.medal.' + k), formatTime(m[k])))));
    else if (this.aiNote) el.append(h('div.ai-note', this.aiNote));
  }

  runAI() {
    if (this.check.errors.length) { this.ui.toast('Fix the problems first.', 'err'); return; }
    let v;
    try { v = new Verifier(buildDef(this.current()), { maxTime: 600 }); } catch (e) { this.ui.toast(e.message, 'err'); return; }
    this.verifier = v;
    this.aiNote = '';
    const layout = this.snapshot();
    const slice = () => {
      if (this.verifier !== v || this.ui.editor !== this) return;
      const t0 = performance.now();
      while (!v.done && performance.now() - t0 < 14) v.step(120);
      if (!v.done) { this.renderAI(); setTimeout(slice, 0); return; }
      this.verifier = null;
      const r = v.result;
      if (this.snapshot() !== layout) { this.aiNote = 'The track changed during the test - run it again.'; this.renderAI(); return; }
      if (r.finished && r.respawns === 0) {
        this.mark();
        this.def.medals = medalsFromTime(r.time);
        this.aiNote = '';
        this.touch(false);
        this.ui.toast(`The AI finished in ${formatTime(r.time * 1000)} - medal times set.`);
      } else if (r.finished) {
        const where = [...new Set(r.trouble.map((p) => p.piece + 1))].filter((k) => k <= this.model.length);
        this.aiNote = `The AI finished but was put back ${r.respawns}× (piece ${where.join(', ')}). Smooth those parts out to earn medal times.`;
        if (where.length) this.select(where[0] - 1, true);
      } else this.aiNote = 'The AI could not finish this track.';
      this.renderAI();
    };
    this.renderAI();
    setTimeout(slice, 30);
  }

  // ---- library, new, import, share, test drive ----------------------------------------------
  modalOpen(title, ...body) {
    this.modalClose();
    const close = button('Close', () => this.modalClose(), 'small ghost');
    this.modal = h('div.ed-modal', { onclick: (e) => { if (e.target === this.modal) this.modalClose(); } }, h('div.panel.ed-dialog', h('div.dlg-head', h('h2', title), close), ...body));
    this.el.append(this.modal);
    return this.modal;
  }

  modalClose() { this.modal?.remove(); this.modal = null; }

  openLibrary() {
    const list = library();
    const grid = h('div.lib-grid');
    for (const d of list) {
      grid.append(h('div.lib-card' + (d.slot === this.slot ? '.on' : ''),
        trackThumb(buildDef(d), 220, 130),
        h('b', d.name), h('span', `${THEMES[d.theme]?.name || ''} · ${d.laps ? d.laps + ' laps' : 'Sprint'}${d.medals ? ' · AI tested' : ''}`),
        h('div.row',
          button('Open', () => { this.modalClose(); this.openDef(d, d.slot); }, 'tiny primary'),
          button('Copy', () => { const c = saveToLibrary({ ...d, slot: undefined, name: (d.name + ' copy').slice(0, LIMITS.name) }); this.modalClose(); this.openDef(c, c.slot); }, 'tiny'),
          button('Delete', () => { if (!confirm(`Delete "${d.name}"? This can't be undone.`)) return; deleteFromLibrary(d.slot); if (d.slot === this.slot) { this.modalClose(); this.newTrack(); } else this.openLibrary(); }, 'tiny danger'))));
    }
    this.modalOpen('My tracks', list.length ? grid : h('p.note', 'No saved tracks yet.'), h('p.note', `${list.length} track${list.length === 1 ? '' : 's'} saved in this browser.`));
  }

  openDef(def, slot) {
    this.slot = slot;
    this.load(def);
    this.sel = -1;
    this.history = []; this.future = [];
    this.nameInput.value = this.def.name;
    this.tab = 'track';
    this.renderList(); this.renderInspector();
    this.rebuild(true);
    this.renderAI();
    this.app.editorState = { def: this.current(), slot: this.slot, sel: -1 };
  }

  newTrack() {
    const saved = saveToLibrary(finalize(templateDef(this.defaultName())));
    this.openDef(saved, saved.slot);
    this.ui.toast('New track started - it saves as you go.');
  }

  openImport() {
    const ta = h('textarea.ed-code', { placeholder: 'Paste a track code (PT1.…) or the contents of a .polytrack.json file', spellcheck: false, rows: 5 });
    const file = h('input', { type: 'file', accept: '.json,application/json,text/plain', style: { display: 'none' } });
    const msg = h('div.note');
    const take = async (text) => {
      try {
        const def = await decodeShare(text);
        const have = library().find((d) => d.id === def.id);
        if (have) { this.modalClose(); this.openDef(have, have.slot); this.ui.toast(`You already have "${have.name}" - opened it`); return; }
        const saved = saveToLibrary({ ...def, slot: undefined });
        this.modalClose();
        this.openDef(saved, saved.slot);
        this.ui.toast(`Imported "${saved.name}"`);
      } catch (e) { msg.textContent = e.message; msg.className = 'note err'; }
    };
    file.addEventListener('change', async () => { const f = file.files[0]; if (!f) return; if (f.size > 300000) { msg.textContent = 'That file is too big to be a track.'; return; } take(await f.text()); });
    const m = this.modalOpen('Import a track', ta,
      h('div.row', button('Import code', () => take(ta.value), 'primary small'), button([icon('upload'), h('span', 'Open a file…')], () => file.click(), 'small'), file),
      msg, h('p.note', 'You can also drop a .polytrack.json file anywhere on this window.'));
    ta.focus();
    void m;
  }

  async openExport() {
    const def = this.current();
    const box = h('textarea.ed-code', { readonly: true, rows: 4, spellcheck: false }, 'Making a code…');
    const copy = button([icon('copy'), h('span', 'Copy code')], () => { box.select(); navigator.clipboard?.writeText(box.value).then(() => this.ui.toast('Track code copied'), () => document.execCommand?.('copy')); }, 'primary small');
    const dl = button([icon('download'), h('span', 'Download file')], () => {
      const { id, custom, ...rest } = def; void id; void custom;
      const blob = new Blob([JSON.stringify({ polytrack: 1, ...rest }, null, 2)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: fileName(def) });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'small');
    this.modalOpen('Share this track', h('p.note', 'Send the code to a friend - they paste it into Import. Or save it as a file. In an online room, the host can simply pick it from their tracks and everyone gets it.'), box, h('div.row', copy, dl));
    try { box.value = await encodeShare(def); } catch (e) { box.value = 'Could not make a code: ' + e.message; }
  }

  testDrive() {
    if (this.check.errors.length) { this.ui.toast(this.check.errors[0], 'err'); return; }
    this.save();
    this.app.audio.play('select');
    this.app.startRace({ def: buildDef(this.current()), mode: 'timetrial', editor: true });
  }

  back() {
    clearTimeout(this._saveT);
    this.save();
    this.app.audio.play('back');
    this.app.toMenu('title');
  }

  update(dt) {
    this.view.update(dt, this.viewEl.getBoundingClientRect());
    if (this.verifier && (this._aiT = (this._aiT || 0) + dt) > 0.2) { this._aiT = 0; this.renderAI(); }
  }

  destroy() {
    clearTimeout(this._buildT);
    if (this._saveT) { clearTimeout(this._saveT); this.save(); }
    this.verifier = null;
    document.removeEventListener('keydown', this._key);
    this.view.dispose();
    if (this.ui.editor === this) this.ui.editor = null;
  }
}

function row(label, ctl) { return h('div.set-row', h('div.set-label', label), ctl); }

function describe(p) {
  const f = (v) => Math.round(v * 10) / 10;
  const slope = Math.abs(p.dh || 0) >= 0.05 ? ` ${p.dh > 0 ? '↑' : '↓'}${Math.abs(f(p.dh))} m` : '';
  switch (p.type) {
    case 'S': return `Straight ${f(p.len)} m${slope}`;
    case 'L': case 'R': return `${p.type === 'L' ? 'Left' : 'Right'} ${f(p.deg)}° r${f(p.r)}${p.bank ? ` bank ${f(p.bank)}°` : ''}${slope}`;
    case 'K': return `Ramp ${f(p.len)} m, ${f(p.lip)}°`;
    case 'J': return `Gap ${f(p.len)} m${p.dh ? `, land ${p.dh > 0 ? '+' : ''}${f(p.dh)} m` : ''}`;
    case 'LOOP': return `Loop r${f(p.loopR)}`;
    default: return p.type;
  }
}

// drop a .polytrack.json anywhere while the editor is open
export function editorDrop(app) {
  window.addEventListener('dragover', (e) => { if (app.ui.editor) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    const ed = app.ui.editor;
    if (!ed) return;
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (!f || f.size > 300000) return;
    try {
      const def = await decodeShare(await f.text());
      const have = library().find((d) => d.id === def.id);
      const saved = have || saveToLibrary({ ...def, slot: undefined });
      ed.modalClose();
      ed.openDef(saved, saved.slot);
      app.ui.toast(`Imported "${saved.name}"`);
    } catch (err) { app.ui.toast(err.message, 'err'); }
  });
}

