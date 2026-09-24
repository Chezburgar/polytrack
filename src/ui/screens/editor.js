// Track Builder: fly around a 3D grid and build a track out of blocks - roads,
// turns, slopes, ramps, loops, checkpoints - the way the original PolyTrack's
// editor works. The route from the Start block is worked out as you build
// (track/blocks.js), shown as a glowing line, and problems are pinned where
// they are. The track saves itself as you go; test drive it, let the AI prove
// it and set medal times, share it as a code or a file.
import * as THREE from 'three';
import { h, icon, clear } from '../dom.js';
import { button } from '../ui.js';
import { buildTrack } from '../../track/builder.js';
import { buildTrackGeometry } from '../../track/geometry.js';
import { buildTrackView } from '../../render/trackview.js';
import { buildSky, followSky } from '../../render/sky.js';
import { THEMES } from '../../track/themes.js';
import { formatTime } from '../../util/math.js';
import {
  BLOCKS, BLOCK_IDS, CATS, TILE, LAYER, BASE_H, LIMITS as BL, SURFACES, WALLS, BANKS, DIRS,
  blockEnds, blockCells, occupancy, fits, solveRoute, routeDef, openEnds, blockPieces, unpackBlock, packBlock, templateBlocks, toWorld,
} from '../../track/blocks.js';
import { blockDef, library, saveToLibrary, deleteFromLibrary, encodeShare, decodeShare, fileName, shareable, buildDef, LIMITS } from '../../track/custom.js';
import { Verifier, medalsFromTime } from '../../game/verify.js';
import { trackThumb } from './play.js';

const DIFF = ['Easy', 'Medium', 'Hard', 'Expert'];
const ROT = (r) => (r * Math.PI) / 2;

// ---- block models ------------------------------------------------------------------
// Each block is built by the real track builder as a one-block road (so what
// you see is what you drive), cached per look and height, and cloned per block.
// Clones share the cached geometry, so only overlay meshes are ever disposed.
const templates = new Map();
function templateKey(b, themeId) {
  const p = b.p || {};
  return [b.t, b.y, p.surf || '', p.walls || '', p.bank || 0, p.tunnel ? 1 : 0, themeId].join('|');
}
function blockTemplate(b, themeId) {
  const key = templateKey(b, themeId);
  let g = templates.get(key);
  if (g) return g;
  const bd = BLOCKS[b.t];
  const d = {
    id: 'blk-' + b.t, theme: themeId, laps: 0, runoff: false, width: 14, walls: 'turns',
    pieces: blockPieces({ ...b, r: 0 }, 0), startHeight: BASE_H + b.y * LAYER, startOffset: bd.gate === 'start' ? 36 : 0,
  };
  if (bd.gate === 'finish') d.finishAt = 1;
  const track = buildTrack(d);
  const theme = THEMES[themeId] || THEMES.meadow;
  g = buildTrackView(buildTrackGeometry(track, theme, { marks: bd.gate ? [bd.gate] : [] }), theme);
  if (templates.size > 500) templates.clear();
  templates.set(key, g);
  return g;
}

// palette icon: the block's own centre line seen from above
const iconCache = new Map();
function blockIcon(t) {
  if (iconCache.has(t)) return iconCache.get(t);
  const bd = BLOCKS[t];
  const track = buildTrack({ id: 'icon', laps: 0, runoff: false, width: 14, pieces: bd.pieces });
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, , z] of bd.cells) { x0 = Math.min(x0, x - 0.5); x1 = Math.max(x1, x + 0.5); z0 = Math.min(z0, z - 0.5); z1 = Math.max(z1, z + 0.5); }
  const S = 44, pad = 4;
  const k = (S - pad * 2) / Math.max(x1 - x0, z1 - z0);
  const ox = pad + ((S - pad * 2) - (x1 - x0) * k) / 2, oz = pad + ((S - pad * 2) - (z1 - z0) * k) / 2;
  // tile coords -> icon: +x (left) draws left, forward draws up; the builder's
  // road starts at the anchor's back edge, i.e. tile z = metres / TILE - 0.5
  const ix = (tx) => ox + (x1 - tx) * k, iz = (tz) => oz + (z1 - tz) * k;
  let cellsSvg = '';
  const seen = new Set();
  for (const [x, , z] of bd.cells) {
    if (seen.has(x + ',' + z)) continue;
    seen.add(x + ',' + z);
    cellsSvg += `<rect x="${ix(x + 0.5).toFixed(1)}" y="${iz(z + 0.5).toFixed(1)}" width="${k.toFixed(1)}" height="${k.toFixed(1)}" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.14)"/>`;
  }
  const P = track.samples.filter((s, i) => i % 2 === 0 || i === track.samples.length - 1).map((s) => [ix(s.p.x / TILE), iz(s.p.z / TILE - 0.5)]);
  const pts = P.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ');
  const col = bd.cat === 'height' ? '#ffd23c' : bd.cat === 'stunt' ? '#ff7ad9' : bd.cat === 'special' ? '#3dff8b' : '#39e6ff';
  const [lx, lz] = P[P.length - 1];
  const c = S / 2;
  let extra = '';
  if (bd.kicker) extra += `<rect x="${(lx - 8).toFixed(1)}" y="${(lz - 2).toFixed(1)}" width="16" height="4" fill="#ffc21a"/>`;
  if (t.startsWith('loop')) extra += `<circle cx="${c}" cy="${c}" r="${S * 0.2}" fill="none" stroke="${col}" stroke-width="3"/>`;
  if (/up|climb/i.test(t)) extra += `<path d="M${c - 6} ${c + 3} L${c} ${c - 5} L${c + 6} ${c + 3}" fill="none" stroke="#0b101b" stroke-width="3"/>`;
  if (/down|drop/i.test(t)) extra += `<path d="M${c - 6} ${c - 3} L${c} ${c + 5} L${c + 6} ${c - 3}" fill="none" stroke="#0b101b" stroke-width="3"/>`;
  if (bd.gate) extra += `<rect x="${c - 11}" y="${c - 2}" width="22" height="4" fill="${bd.gate === 'cp' ? '#ffd23c' : '#fff'}"/>`;
  if (t === 'boost') extra += `<path d="M${c - 6} ${c + 4} L${c} ${c - 3} L${c + 6} ${c + 4}" fill="none" stroke="#0b101b" stroke-width="3"/>`;
  const svg = `<svg viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">${cellsSvg}<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>${extra}</svg>`;
  iconCache.set(t, svg);
  return svg;
}

// ---- the 3D view -----------------------------------------------------------------------
class BlockView {
  constructor(renderer) {
    this.r = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.5, 9000);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x445544, 1.3);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.scene.add(this.hemi, this.sun);
    this.fog = new THREE.Fog(0xffffff, 600, 3200);
    this.scene.fog = this.fog;
    this.blocksRoot = new THREE.Group();
    this.overlay = new THREE.Group();
    this.scene.add(this.blocksRoot, this.overlay);
    this.inst = new Map(); // block uid -> { key, obj }
    // build plane: grid lines on the square edges, a faint sheet, the hovered square
    const size = (BL.span * 2 + 2) * TILE;
    this.grid = new THREE.GridHelper(size, BL.span * 2 + 2, 0xffffff, 0xffffff);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.22;
    this.grid.material.depthWrite = false;
    this.grid.position.set(TILE / 2, 0, TILE / 2);
    this.sheet = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ color: 0x39c6f0, transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide }));
    this.sheet.rotation.x = -Math.PI / 2;
    this.sheet.position.set(TILE / 2, 0, TILE / 2);
    const sq = new THREE.BufferGeometry().setFromPoints([[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([a, b]) => new THREE.Vector3((a * TILE) / 2, 0, (b * TILE) / 2)));
    this.cursor = new THREE.Line(sq, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false }));
    this.cursor.renderOrder = 10;
    this.scene.add(this.grid, this.sheet, this.cursor);
    // shared overlay materials / shapes
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x3dff8b, transparent: true, opacity: 0.42, depthWrite: false });
    this.arrowGeo = new THREE.ConeGeometry(2.2, 5, 4);
    this.arrowGeo.rotateX(Math.PI / 2);
    this.arrowMat = new THREE.MeshBasicMaterial({ color: 0x39e6ff });
    this.pinGeo = new THREE.ConeGeometry(2.4, 9, 6);
    this.pinMat = new THREE.MeshBasicMaterial({ color: 0xff3d3d });
    this.looseMat = new THREE.MeshBasicMaterial({ color: 0xff3d3d, transparent: true, opacity: 0.22, depthWrite: false });
    this.selMat = new THREE.MeshBasicMaterial({ color: 0x39e6ff, transparent: true, opacity: 0.28, depthWrite: false });
    this.shared = new Set([this.arrowGeo, this.arrowMat, this.pinGeo, this.pinMat, this.looseMat, this.selMat]);
    this.ghost = null;
    this.cam = { pos: new THREE.Vector3(-60, 70, -80), yaw: 0.6, pitch: 0.55 };
    this.goal = null;
    this.themeId = null;
    this.layerY = BASE_H;
  }

  setTheme(id) {
    if (this.themeId === id) return;
    this.themeId = id;
    const th = THEMES[id] || THEMES.meadow;
    this.theme = th;
    if (this.sky) { this.scene.remove(this.sky); disposeTree(this.sky); }
    this.sky = buildSky({ ...th, mountains: null }, 5);
    this.scene.add(this.sky);
    this.hemi.color.set(th.hemi.sky); this.hemi.groundColor.set(th.hemi.ground);
    this.hemi.intensity = th.hemi.intensity * (th.night ? 2 : 1.25);
    this.sun.color.set(th.sun.color); this.sun.intensity = th.sun.intensity * (th.night ? 1.7 : 1);
    this.sun.position.set(...th.sun.dir);
    this.scene.background = new THREE.Color(th.sky.horizon);
    this.fog.color.set(th.fog.color);
    if (this.ground) { this.scene.remove(this.ground); disposeTree(this.ground); this.ground = null; }
    if (th.ground !== 'void') {
      const wet = th.ground === 'water' || th.ground === 'lava';
      const col = wet ? th.waterColor ?? (th.ground === 'lava' ? 0xff5a1a : 0x1fb5c9) : th.groundColors?.[0] ?? 0x6fae45;
      const mat = th.ground === 'lava' ? new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(1.3) }) : new THREE.MeshLambertMaterial({ color: col });
      this.ground = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000), mat);
      this.ground.rotation.x = -Math.PI / 2;
      this.ground.position.y = wet ? -2.2 : -0.06;
      this.scene.add(this.ground);
    }
    // every block looks different in another scenery
    for (const v of this.inst.values()) this.blocksRoot.remove(v.obj);
    this.inst.clear();
  }

  // keep one clone per block; rebuild only what changed
  setBlocks(blocks) {
    const seen = new Set();
    blocks.forEach((b, i) => {
      seen.add(b.uid);
      const key = templateKey(b, this.themeId) + `|${b.x},${b.z},${b.r}`;
      const had = this.inst.get(b.uid);
      if (had && had.key === key) { had.obj.userData.bi = i; return; }
      if (had) this.blocksRoot.remove(had.obj);
      const obj = blockTemplate(b, this.themeId).clone();
      const [ex, ez] = toWorld(b, 0, -0.5);
      obj.position.set(ex * TILE, 0, ez * TILE);
      obj.rotation.y = ROT(b.r);
      obj.userData.bi = i;
      obj.userData.uid = b.uid;
      this.blocksRoot.add(obj);
      this.inst.set(b.uid, { key, obj });
    });
    for (const [uid, v] of this.inst) if (!seen.has(uid)) { this.blocksRoot.remove(v.obj); this.inst.delete(uid); }
  }

  setLayer(y) {
    const hgt = BASE_H + y * LAYER - 0.08;
    this.grid.position.y = hgt;
    this.sheet.position.y = hgt - 0.02;
    this.layerY = hgt;
  }

  setCursor(cell) {
    this.cursor.visible = !!cell;
    if (cell) this.cursor.position.set(cell.x * TILE, this.layerY + 0.4, cell.z * TILE);
  }

  setGhost(b, ok) {
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
    if (!b) return;
    const g = blockTemplate(b, this.themeId).clone();
    g.traverse((o) => { if (o.isMesh) { o.material = this.ghostMat; o.castShadow = false; o.renderOrder = 4; } });
    const [ex, ez] = toWorld(b, 0, -0.5);
    g.position.set(ex * TILE, 0.05, ez * TILE);
    g.rotation.y = ROT(b.r);
    this.ghostMat.color.set(ok ? 0x3dff8b : 0xff4a4a);
    this.ghost = g;
    this.scene.add(g);
  }

  // route ribbon, arrows on open ends, trouble pins, loose and selected blocks
  setOverlay({ route, blocks, sel, loose, pins, ends }) {
    for (const o of [...this.overlay.children]) { this.overlay.remove(o); this.disposeOverlay(o); }
    if (route) this.overlay.add(route);
    for (const e of ends) {
      const a = new THREE.Mesh(this.arrowGeo, this.arrowMat);
      const [dx, dz] = DIRS[e.dir];
      a.position.set((e.x + dx * 0.15) * TILE, BASE_H + e.y * LAYER + 2.2, (e.z + dz * 0.15) * TILE);
      a.lookAt(a.position.x + dx, a.position.y, a.position.z + dz);
      this.overlay.add(a);
    }
    for (const p of pins) {
      const pin = new THREE.Mesh(this.pinGeo, this.pinMat);
      pin.rotation.x = Math.PI;
      pin.position.set(p.x * TILE, BASE_H + p.y * LAYER + 8, p.z * TILE);
      this.overlay.add(pin);
    }
    const boxFor = (b, mat) => {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, , z] of blockCells(b)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      const m = new THREE.Mesh(new THREE.BoxGeometry((x1 - x0 + 1) * TILE - 1, 3, (z1 - z0 + 1) * TILE - 1), mat);
      m.position.set(((x0 + x1) / 2) * TILE, BASE_H + b.y * LAYER + 1.2, ((z0 + z1) / 2) * TILE);
      m.renderOrder = 6;
      return m;
    };
    for (const i of loose) if (blocks[i]) this.overlay.add(boxFor(blocks[i], this.looseMat));
    if (sel >= 0 && blocks[sel]) this.overlay.add(boxFor(blocks[sel], this.selMat));
  }

  disposeOverlay(o) {
    if (o.geometry && !this.shared.has(o.geometry)) o.geometry.dispose();
    if (o.material && !this.shared.has(o.material)) o.material.dispose();
  }

  pick(ray) {
    for (const hit of ray.intersectObjects(this.blocksRoot.children, true)) {
      let o = hit.object;
      while (o && o.userData.uid == null) o = o.parent;
      if (o) return o.userData.uid;
    }
    return null;
  }

  glide(pos, yaw, pitch) { this.goal = { pos: pos.clone(), yaw, pitch }; }

  update(dt) {
    const c = this.cam;
    if (this.goal) {
      const k = 1 - Math.exp(-dt * 5);
      c.pos.lerp(this.goal.pos, k);
      c.yaw += (this.goal.yaw - c.yaw) * k;
      c.pitch += (this.goal.pitch - c.pitch) * k;
      if (c.pos.distanceTo(this.goal.pos) < 0.3) this.goal = null;
    }
    const r = this.r.renderer;
    const W = r.domElement.clientWidth, H = r.domElement.clientHeight;
    const cam = this.camera;
    cam.aspect = W / Math.max(1, H);
    cam.clearViewOffset();
    cam.position.copy(c.pos);
    const cp = Math.cos(c.pitch);
    cam.lookAt(c.pos.x + Math.sin(c.yaw) * cp, c.pos.y - Math.sin(c.pitch), c.pos.z + Math.cos(c.yaw) * cp);
    cam.updateProjectionMatrix();
    if (this.sky) followSky(this.sky, cam.position);
    this.fog.near = 400 + c.pos.y * 2;
    this.fog.far = 2600 + c.pos.y * 6;
    r.toneMappingExposure = this.theme?.exposure ?? 1;
    r.render(this.scene, cam);
  }

  dispose() {
    // block clones and the ghost share the cached templates: keep those
    this.scene.remove(this.blocksRoot);
    if (this.ghost) this.scene.remove(this.ghost);
    for (const o of [...this.overlay.children]) { this.overlay.remove(o); this.disposeOverlay(o); }
    for (const x of this.shared) x.dispose();
    this.ghostMat.dispose();
    disposeTree(this.scene);
  }
}

function disposeTree(o) {
  o.traverse((c) => {
    c.geometry?.dispose();
    if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => { m.map?.dispose(); m.dispose(); });
  });
}

// a see-through ribbon along the route, with chevrons pointing the way
function routeRibbon(track) {
  const S = track.samples;
  const pos = [];
  const lift = 0.6, hw = 1.3;
  const at = (sm, side, dz = 0) => sm.p.clone().addScaledVector(sm.l, side).addScaledVector(sm.n, lift).addScaledVector(sm.t, dz);
  for (let i = 0; i + 1 < S.length; i++) {
    const a = S[i], b = S[i + 1];
    const a0 = at(a, hw), a1 = at(a, -hw), b0 = at(b, hw), b1 = at(b, -hw);
    pos.push(a0.x, a0.y, a0.z, a1.x, a1.y, a1.z, b1.x, b1.y, b1.z, a0.x, a0.y, a0.z, b1.x, b1.y, b1.z, b0.x, b0.y, b0.z);
  }
  for (let i = 20; i < S.length - 6; i += 40) {
    const sm = S[i];
    const tip = at(sm, 0, 3.5), l = at(sm, 3.4), rr = at(sm, -3.4);
    pos.push(tip.x, tip.y, tip.z, l.x, l.y, l.z, rr.x, rr.y, rr.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x39e6ff, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }));
  m.renderOrder = 7;
  return m;
}

// ---- the screen -----------------------------------------------------------------------------
let uidSeq = 1;
const withUid = (b) => ({ ...b, uid: uidSeq++ });

export class EditorScreen {
  constructor(ui, data = {}) {
    this.ui = ui;
    const app = (this.app = ui.app);
    ui.editor = this;
    this.view = new BlockView(app.renderer);
    this.tool = 'place';
    this.pickType = 'road';
    this.cat = 'road';
    this.rot = 0;
    this.layer = 0;
    this.sel = -1;
    this.hover = null;
    this.keys = new Set();
    this.history = [];
    this.future = [];
    this.tab = 'track';
    this.warnings = [];
    // what to edit: a given track, last session's, the newest saved, or a new one
    const st = data.def?.blocks ? { def: data.def, slot: data.slot } : app.editorState?.def?.blocks ? app.editorState : null;
    let def = st?.def, slot = st?.slot;
    if (!def) { const lib = library().filter((d) => d.blocks); if (lib.length) { def = lib[0]; slot = lib[0].slot; } }
    if (!def) { const saved = saveToLibrary(blockDef(this.newMeta(), templateBlocks())); def = saved; slot = saved.slot; }
    this.slot = slot;
    this.load(def);

    this.nameInput = h('input.name-input.be-name', { type: 'text', maxLength: LIMITS.name, value: this.meta.name, placeholder: 'Track name', spellcheck: false });
    this.nameInput.addEventListener('input', () => { this.meta.name = this.nameInput.value.slice(0, LIMITS.name); this.touch(false); });
    this.undoBtn = button([icon('undo')], () => this.undo(), 'icon-btn small', { title: 'Undo (Ctrl+Z)' });
    this.redoBtn = button([icon('redo')], () => this.redo(), 'icon-btn small', { title: 'Redo (Ctrl+Y)' });
    this.savedEl = h('span.ed-saved', 'Saved');
    this.sideEl = h('div.be-side-body');
    this.tabsEl = h('div.ed-tabs');
    this.statusEl = h('div.be-status');
    this.aiEl = h('div.be-ai');
    this.paletteEl = h('div.be-palette');
    this.layerEl = h('div.be-layer');
    this.viewEl = h('div.be-view');
    this.helpEl = h('div.be-help.panel');
    this.helpEl.hidden = true;
    this.el = h('div.screen.block-editor',
      this.viewEl,
      h('div.be-top',
        button([icon('back')], () => this.back(), 'icon-btn', { title: 'Back to the menu' }),
        h('h1', 'Track Builder'),
        this.nameInput, this.undoBtn, this.redoBtn, this.savedEl,
        h('div.ed-actions',
          button('?', () => this.toggleHelp(), 'small', { title: 'Controls (H)' }),
          button([icon('folder'), h('span', 'Tracks')], () => this.openLibrary(), 'small', { title: 'My tracks' }),
          button([icon('plus'), h('span', 'New')], () => this.newTrack(), 'small'),
          button([icon('upload'), h('span', 'Import')], () => this.openImport(), 'small'),
          button([icon('share'), h('span', 'Share')], () => this.openExport(), 'small'),
          button([icon('flag'), h('span', 'Test drive')], () => this.testDrive(), 'primary small', { title: 'Test drive (T)' }))),
      h('div.be-side.panel', this.tabsEl, this.sideEl),
      h('div.be-left', this.statusEl, this.aiEl),
      h('div.be-dock', this.layerEl, this.paletteEl),
      this.helpEl);
    this.bindView();
    this._key = (e) => this.onKey(e);
    this._keyUp = (e) => this.keys.delete(e.code);
    this._blur = () => this.keys.clear();
    document.addEventListener('keydown', this._key);
    document.addEventListener('keyup', this._keyUp);
    window.addEventListener('blur', this._blur);
    this.renderPalette();
    this.renderHelp();
    this.renderSide();
    this.refresh();
    this.frame(true);
    this.renderAI();
    this.updateUndo();
  }

  newMeta() { return { name: `${this.app.playerName()}'s Track`.slice(0, LIMITS.name), theme: 'meadow', laps: 3, difficulty: 1 }; }

  load(def) {
    this.meta = { name: def.name, author: def.author, theme: def.theme, laps: def.laps || 3, difficulty: def.difficulty ?? 1 };
    if (def.medals) this.meta.medals = def.medals;
    this.blocks = (def.blocks || []).map(unpackBlock).filter(Boolean).map(withUid);
    this.sel = -1;
  }

  current() {
    return blockDef({ ...this.meta, author: this.meta.author || this.app.playerName() }, this.blocks);
  }

  // ---- change tracking ---------------------------------------------------------------------
  snapshot() { return JSON.stringify({ meta: this.meta, blocks: this.blocks.map(packBlock) }); }

  mark() {
    const s = this.snapshot();
    if (this.history[this.history.length - 1] !== s) this.history.push(s);
    if (this.history.length > 150) this.history.shift();
    this.future = [];
  }

  touch(layout = true) {
    if (layout) delete this.meta.medals; // medal times belong to the old layout
    clearTimeout(this._saveT);
    this.savedEl.textContent = 'Saving…';
    this._saveT = setTimeout(() => this.save(), 700);
    if (layout) this.refresh();
    this.updateUndo();
  }

  save() {
    this._saveT = null;
    const saved = saveToLibrary({ ...this.current(), slot: this.slot });
    this.slot = saved.slot;
    this.app.editorState = { def: this.current(), slot: this.slot };
    this.savedEl.textContent = 'Saved';
  }

  undo() { if (!this.history.length) return; this.future.push(this.snapshot()); this.restore(this.history.pop()); }
  redo() { if (!this.future.length) return; this.history.push(this.snapshot()); this.restore(this.future.pop()); }
  restore(s) {
    const { meta, blocks } = JSON.parse(s);
    this.meta = meta;
    this.blocks = blocks.map(unpackBlock).filter(Boolean).map(withUid);
    this.sel = -1;
    this.nameInput.value = this.meta.name;
    this.touch(false);
    this.refresh();
    this.renderSide();
  }
  updateUndo() { this.undoBtn.disabled = !this.history.length; this.redoBtn.disabled = !this.future.length; }

  // ---- route + checks ------------------------------------------------------------------------
  refresh() {
    this.view.setTheme(this.meta.theme);
    this.view.setBlocks(this.blocks);
    this.view.setLayer(this.layer);
    this.occ = occupancy(this.blocks);
    const route = (this.route = solveRoute(this.blocks));
    let ribbon = null, track = null;
    if (route.pieces.length) {
      try {
        const d = { ...routeDef(this.meta, this.blocks, route), id: 'route', runoff: false };
        if (!route.ok) d.laps = 0;
        track = buildTrack(d);
        ribbon = routeRibbon(track);
      } catch (e) { console.warn('route build failed', e); }
    }
    this.routeTrack = route.ok ? track : null;
    this.warnings = route.ok && track ? this.checkRoute(route, track) : [];
    const pins = route.errors.filter((e) => e.at).map((e) => this.pointOf(e.at));
    for (const w of this.warnings) if (w.at) pins.push(this.pointOf(w.at));
    this.view.setOverlay({ route: ribbon, blocks: this.blocks, sel: this.sel, loose: route.start ? route.loose : [], pins, ends: openEnds(this.blocks) });
    this.renderStatus();
    this._ghostKey = '';
    this.updateGhost();
    this.renderLayer();
  }

  pointOf(at) {
    if (at.t) { // a block: its middle
      const cells = blockCells(at);
      return { x: cells.reduce((a, c) => a + c[0], 0) / cells.length, y: at.y, z: cells.reduce((a, c) => a + c[2], 0) / cells.length };
    }
    return at;
  }

  // what a raceable route should still fix: ramp run-ups, loop speed
  checkRoute(route, track) {
    const out = [];
    const P = track.pieces;
    const blockAt = (piece) => { const seg = route.route.find((s) => piece >= s.p0 && piece < s.p1); return seg ? this.blocks[seg.i] : null; };
    P.forEach((p, k) => {
      const run = () => { let m = 0; for (let j = k - 1; j >= 0 && P[j].type === 'S'; j--) m += P[j].len; return m; };
      if (p.type === 'K' && run() < 48) out.push({ text: 'A ramp needs about 3 squares of straight road before it, or cars launch crooked.', at: blockAt(k) });
      if (p.type === 'LOOP' && run() < 40) out.push({ text: 'A loop needs a straight run-up to carry enough speed (a boost pad helps).', at: blockAt(k) });
    });
    if (track.length < 250) out.push({ text: 'The track is very short - add more road.' });
    return out;
  }

  renderStatus() {
    const r = this.route, el = this.statusEl;
    clear(el);
    const t = this.routeTrack;
    const kind = r.ok ? (r.closed ? `Circuit · ${this.meta.laps} laps` : 'Sprint') : 'Not raceable yet';
    el.append(h('div.ed-facts', h('b', t ? `${(t.length / 1000).toFixed(2)} km` : '--'), h('span', kind), h('span', `${this.blocks.length} blocks`), t ? h('span', `${t.checkpoints.length} checkpoints`) : null));
    const list = h('div.ed-issues');
    for (const e of r.errors.slice(0, 2)) list.append(h('button.issue.err', { type: 'button', onclick: () => e.at && this.flyTo(this.pointOf(e.at)) }, e.text));
    if (r.ok && r.loose.length) list.append(h('div.issue.warn', `${r.loose.length} block${r.loose.length === 1 ? ' is' : 's are'} not on the route (red) - they won't be in the race.`));
    for (const w of this.warnings.slice(0, 2)) list.append(h('button.issue.warn', { type: 'button', onclick: () => w.at && this.flyTo(this.pointOf(w.at)) }, w.text));
    if (r.ok && !r.loose.length && !this.warnings.length) list.append(h('div.issue.ok', r.closed ? 'Ready to race - the road loops back to the Start.' : 'Ready to race - the road reaches the Finish.'));
    el.append(list);
  }

  renderLayer() {
    clear(this.layerEl);
    this.layerEl.append(
      h('span', 'Height'),
      button('▼', () => this.setLayer(this.layer - 1), 'tiny', { title: 'Down (Page Down / Q)' }),
      h('b', String(this.layer)),
      button('▲', () => this.setLayer(this.layer + 1), 'tiny', { title: 'Up (Page Up / E)' }),
      h('span.be-rot', 'Turn'),
      button('↺', () => this.rotate(-1), 'tiny', { title: 'Rotate back (Shift+R)' }),
      h('b', `${this.rot * 90}°`),
      button('↻', () => this.rotate(1), 'tiny', { title: 'Rotate (R)' }));
  }

  setLayer(y) {
    this.layer = Math.max(0, Math.min(BL.top, y));
    this.view.setLayer(this.layer);
    this.renderLayer();
    this._ghostKey = '';
    this.updateGhost();
  }

  rotate(d) {
    if (this.tool === 'select' && this.sel >= 0) { this.rotateSelected(d); return; }
    this.rot = (this.rot + d + 4) & 3;
    this.renderLayer();
    this.updateGhost();
  }

  // ---- palette, side panel, help ----------------------------------------------------------------
  renderPalette() {
    const el = this.paletteEl;
    clear(el);
    const tool = (id, label, svg, tip) => h('button.be-tool' + (this.tool === id ? '.on' : ''), { type: 'button', title: tip, onclick: () => this.setTool(id) }, h('span.be-ic', { html: svg }), h('small', label));
    el.append(h('div.be-group', h('span.be-cat', 'Tools'),
      tool('select', 'Select', '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M5 3l14 8-6 1.5 3.5 6.5-2.5 1.3-3.5-6.6L6 18z" fill="currentColor"/></svg>', 'Select a block to change or rotate it (Esc)'),
      tool('erase', 'Erase', '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M16 3l5 5-10 10H6l-3-3zM5 21h14" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>', 'Click blocks to erase them (X) - or right-click one any time')));
    // one category at a time; number keys pick within it
    const tabs = h('div.be-cats', ...CATS.map(([cat, label]) => h('button' + (this.cat === cat ? '.on' : ''), { type: 'button', onclick: () => { this.cat = cat; this.renderPalette(); } }, label)));
    const g = h('div.be-group.blocks');
    BLOCK_IDS.filter((id) => BLOCKS[id].cat === this.cat).forEach((t, n) => {
      g.append(h('button.be-block' + (this.tool === 'place' && this.pickType === t ? '.on' : ''), { type: 'button', title: `${BLOCKS[t].name} (${n + 1})`, onclick: () => this.choose(t) },
        h('span.be-ic', { html: blockIcon(t) }), h('small', BLOCKS[t].name), h('i.be-num', String(n + 1))));
    });
    el.append(h('div.be-group.cats', tabs, g));
  }

  choose(t) {
    this.pickType = t;
    this.cat = BLOCKS[t].cat;
    this.setTool('place');
    this.app.audio.play('click');
  }

  setTool(t) {
    this.tool = t;
    if (t !== 'select') { this.sel = -1; if (this.tab === 'block') this.tab = 'track'; }
    this.renderPalette();
    this.renderSide();
    this._ghostKey = '';
    this.updateGhost();
    this.refreshSoon();
  }

  refreshSoon() { clearTimeout(this._ovT); this._ovT = setTimeout(() => this.refresh(), 10); }

  renderSide() {
    clear(this.tabsEl);
    for (const [k, label] of [['block', 'Block'], ['track', 'Track']]) {
      this.tabsEl.append(h('button.tab' + (this.tab === k ? '.on' : ''), { type: 'button', onclick: () => { this.tab = k; this.renderSide(); } }, label));
    }
    clear(this.sideEl);
    if (this.tab === 'block') this.renderBlockPanel(this.sideEl); else this.renderTrackPanel(this.sideEl);
  }

  renderTrackPanel(el) {
    const m = this.meta;
    const theme = h('select.track-select', ...Object.entries(THEMES).map(([id, t]) => h('option', { value: id, selected: id === m.theme }, t.name)));
    theme.addEventListener('change', () => { this.mark(); m.theme = theme.value; this.touch(); });
    const laps = h('div.stepper',
      h('button', { type: 'button', onclick: () => { if (m.laps > 1) { this.mark(); m.laps--; this.renderSide(); this.touch(); } } }, '−'),
      h('b', String(m.laps)),
      h('button', { type: 'button', onclick: () => { if (m.laps < 9) { this.mark(); m.laps++; this.renderSide(); this.touch(); } } }, '+'));
    const diff = h('select.track-select', ...DIFF.map((x, i) => h('option', { value: i, selected: i === m.difficulty }, x)));
    diff.addEventListener('change', () => { this.mark(); m.difficulty = +diff.value; this.touch(false); });
    el.append(
      row('Scenery', theme), row('Laps', laps, 'for circuits'), row('Difficulty', diff),
      h('p.note', 'Build from the Start block, block by block. Bring the road back into the Start for a circuit, or end on a Finish block for a sprint.'),
      h('p.note', 'A ramp jumps over empty squares to the next road ahead (same height or lower). Keep roads at least 2 heights apart to cross over.'));
  }

  renderBlockPanel(el) {
    const b = this.blocks[this.sel];
    if (!b) { el.append(h('p.note', 'Pick the Select tool (Esc) and click a block to change it.')); return; }
    const bd = BLOCKS[b.t];
    const p = b.p || {};
    const set = (patch) => {
      this.mark();
      const np = { ...p, ...patch };
      for (const k of Object.keys(np)) if (!np[k] || np[k] === 'asphalt' || np[k] === 'auto') delete np[k];
      const nb = { ...b };
      if (Object.keys(np).length) nb.p = np; else delete nb.p;
      this.blocks[this.sel] = nb;
      this.touch();
      this.renderSide();
    };
    const sel = (list, cur, labels, fn) => {
      const s = h('select.track-select', ...list.map((v, i) => h('option', { value: String(v), selected: String(v) === String(cur) }, labels ? labels[i] : String(v))));
      s.addEventListener('change', () => fn(s.value));
      return s;
    };
    el.append(h('div.insp-head', h('span.be-ic.small', { html: blockIcon(b.t) }), h('h3', bd.name),
      h('div.insp-tools',
        button('↻', () => this.rotateSelected(1), 'icon-btn tiny', { title: 'Rotate (R)' }),
        button([icon('trash')], () => this.removeAt(this.sel), 'icon-btn tiny danger', { title: 'Delete (Del)' }))));
    el.append(row('Surface', sel(SURFACES, p.surf || 'asphalt', SURFACES.map((s) => s[0].toUpperCase() + s.slice(1)), (v) => set({ surf: v }))));
    el.append(row('Barriers', sel(WALLS, p.walls || 'auto', ['Track default', 'Both sides', 'Left', 'Right', 'None'], (v) => set({ walls: v }))));
    if (bd.pieces.some((s) => /^[LR] /.test(s))) el.append(row('Banking', sel(BANKS, p.bank || 0, BANKS.map((v) => (v ? `${v}°` : 'Flat')), (v) => set({ bank: +v }))));
    el.append(row('Tunnel', h('button.toggle' + (p.tunnel ? '.on' : ''), { type: 'button', onclick: () => set({ tunnel: !p.tunnel }) }, p.tunnel ? 'On' : 'Off')));
    el.append(h('p.note', `Height ${b.y} · square ${b.x}, ${b.z}`));
  }

  renderHelp() {
    const rows = [
      ['Move', 'W A S D / arrows'], ['Up / down', 'Space / Shift'], ['Look around', 'drag with the right (or middle) mouse button'], ['Zoom', 'mouse wheel'],
      ['Place block', 'left click'], ['Pick a block', '1-9  (Tab: next group)'], ['Rotate', 'R  (Shift+R back)'], ['Build height', 'E / Q  or  Page Up / Page Down'],
      ['Erase', 'right click a block, or X for the eraser'], ['Copy a block', 'middle click it'], ['Select tool', 'Esc'], ['Delete selected', 'Delete'],
      ['Undo / redo', 'Ctrl+Z / Ctrl+Y'], ['See the whole track', 'F'], ['Test drive', 'T'],
    ];
    clear(this.helpEl);
    this.helpEl.append(h('div.dlg-head', h('h2', 'Controls'), button('Close', () => this.toggleHelp(false), 'small ghost')),
      h('div.keys', ...rows.map(([a, k]) => h('div.key-row', h('span', a), h('kbd', k)))),
      h('p.note', 'After you place a block, the build height and direction follow the road. Blue arrows mark open road ends; red pins mark problems; the glowing line is the route.'));
  }

  toggleHelp(v) { this.helpEl.hidden = v === undefined ? !this.helpEl.hidden : !v; }

  // ---- placing ----------------------------------------------------------------------------------
  ghostBlock() {
    if (!this.hover || this.tool !== 'place') return null;
    return { t: this.pickType, x: this.hover.x, y: this.layer, z: this.hover.z, r: this.rot };
  }

  updateGhost() {
    const g = this.ghostBlock();
    this.view.setCursor(this.hover && this.tool !== 'select' ? this.hover : null);
    const key = g ? `${g.t}|${g.x}|${g.y}|${g.z}|${g.r}` : '';
    if (key === this._ghostKey) return;
    this._ghostKey = key;
    this.ghostOk = g ? fits(g, this.occ) : false;
    this.view.setGhost(g, this.ghostOk);
  }

  place() {
    const g = this.ghostBlock();
    if (!g) return;
    if (!fits(g, this.occ)) { this.app.audio.play('back'); this.ui.toast('That spot is taken (or out of bounds).', 'err'); return; }
    if (this.blocks.length >= BL.blocks) { this.ui.toast(`Tracks can have up to ${BL.blocks} blocks.`, 'err'); return; }
    if (g.t === 'start' && this.blocks.some((b) => b.t === 'start')) { this.ui.toast('There is already a Start block - erase it first.', 'err'); return; }
    this.mark();
    this.blocks.push(withUid(g));
    this.app.audio.play('click');
    // follow the road: face and build at the new block's open end
    const open = openEnds(this.blocks).filter((e) => e.i === this.blocks.length - 1);
    const exit = open.length === 1 ? open[0] : blockEnds(g)[1];
    this.rot = exit.dir;
    this.layer = Math.max(0, Math.min(BL.top, exit.y));
    this.touch();
  }

  removeAt(i) {
    if (i < 0 || !this.blocks[i]) return;
    this.mark();
    this.blocks.splice(i, 1);
    this.sel = -1;
    this.app.audio.play('back');
    this.touch();
    this.renderSide();
  }

  rotateSelected(d) {
    const i = this.sel;
    const b = this.blocks[i];
    if (!b) return;
    const nb = { ...b, r: (b.r + d + 4) & 3 };
    if (!fits(nb, this.occ, i)) { this.ui.toast('No room to turn it there.', 'err'); return; }
    this.mark();
    this.blocks[i] = nb;
    this.touch();
  }

  uidIndex(uid) { return this.blocks.findIndex((b) => b.uid === uid); }

  // ---- mouse + keys ------------------------------------------------------------------------------
  ray(e) {
    const rect = this.app.renderer.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.view.camera);
    return rc;
  }

  hoverFrom(e) {
    const rc = this.ray(e);
    const hgt = BASE_H + this.layer * LAYER;
    const o = rc.ray.origin, d = rc.ray.direction;
    if (Math.abs(d.y) < 1e-4) return null;
    const t = (hgt - o.y) / d.y;
    if (t <= 0 || t > 6000) return null;
    const x = Math.round((o.x + d.x * t) / TILE), z = Math.round((o.z + d.z * t) / TILE);
    if (Math.abs(x) > BL.span || Math.abs(z) > BL.span) return null;
    return { x, z };
  }

  bindView() {
    const v = this.viewEl;
    let look = null;
    v.addEventListener('contextmenu', (e) => e.preventDefault());
    v.addEventListener('pointerdown', (e) => {
      v.setPointerCapture(e.pointerId);
      this.view.goal = null;
      if (e.button === 2 || e.button === 1 || (e.button === 0 && e.altKey)) {
        e.preventDefault();
        look = { x: e.clientX, y: e.clientY, yaw: this.view.cam.yaw, pitch: this.view.cam.pitch, button: e.button, moved: false };
        return;
      }
      if (e.button !== 0) return;
      this.hover = this.hoverFrom(e);
      this.updateGhost();
      if (this.tool === 'place') this.place();
      else {
        const uid = this.view.pick(this.ray(e));
        const i = uid == null ? -1 : this.uidIndex(uid);
        if (this.tool === 'erase') { if (i >= 0) this.removeAt(i); }
        else { this.sel = i; this.tab = i >= 0 ? 'block' : 'track'; this.renderSide(); this.refreshSoon(); }
      }
    });
    v.addEventListener('pointermove', (e) => {
      if (look) {
        const dx = e.clientX - look.x, dy = e.clientY - look.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) look.moved = true;
        this.view.cam.yaw = look.yaw - dx * 0.005;
        this.view.cam.pitch = Math.max(-0.35, Math.min(1.45, look.pitch + dy * 0.005));
        return;
      }
      const hv = this.hoverFrom(e);
      if (hv?.x !== this.hover?.x || hv?.z !== this.hover?.z) { this.hover = hv; this.updateGhost(); }
    });
    v.addEventListener('pointerup', (e) => {
      if (look && !look.moved) {
        // a click without dragging: right = erase, middle = copy that block
        const uid = this.view.pick(this.ray(e));
        const i = uid == null ? -1 : this.uidIndex(uid);
        if (i >= 0 && look.button === 2) this.removeAt(i);
        if (i >= 0 && look.button === 1) { const b = this.blocks[i]; this.pickType = b.t; this.rot = b.r; this.setLayer(b.y); this.setTool('place'); }
      }
      look = null;
    });
    v.addEventListener('pointerleave', () => { if (!look) { this.hover = null; this.updateGhost(); } });
    v.addEventListener('wheel', (e) => {
      e.preventDefault();
      const c = this.view.cam;
      this.view.goal = null;
      const cp = Math.cos(c.pitch);
      const dir = new THREE.Vector3(Math.sin(c.yaw) * cp, -Math.sin(c.pitch), Math.cos(c.yaw) * cp);
      c.pos.addScaledVector(dir, -Math.sign(e.deltaY) * Math.min(60, 8 + c.pos.y * 0.25));
      c.pos.y = Math.max(3, Math.min(600, c.pos.y));
    }, { passive: false });
  }

  onKey(e) {
    if (this.ui.current !== 'editor') return;
    if (this.modal) { if (e.key === 'Escape') this.modalClose(); return; }
    const tag = document.activeElement?.tagName;
    const typing = (tag === 'INPUT' && document.activeElement.type !== 'range') || tag === 'TEXTAREA' || tag === 'SELECT';
    if (typing) return;
    if (e.ctrlKey || e.metaKey) {
      if (e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); this.undo(); }
      else if (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey)) { e.preventDefault(); this.redo(); }
      return;
    }
    const code = e.code;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight'].includes(code)) {
      this.keys.add(code);
      this.view.goal = null;
      if (code === 'Space' || code.startsWith('Arrow')) e.preventDefault();
      return;
    }
    if (e.repeat) return;
    if (code === 'KeyR') this.rotate(e.shiftKey ? -1 : 1);
    else if (code === 'PageUp' || code === 'KeyE') { e.preventDefault(); this.setLayer(this.layer + 1); }
    else if (code === 'PageDown' || code === 'KeyQ') { e.preventDefault(); this.setLayer(this.layer - 1); }
    else if (code === 'Escape') { if (!this.helpEl.hidden) this.toggleHelp(false); else this.setTool('select'); }
    else if (code === 'KeyX') this.setTool('erase');
    else if (code === 'Delete' || code === 'Backspace') { if (this.sel >= 0) { e.preventDefault(); this.removeAt(this.sel); } }
    else if (code === 'KeyF') this.frame();
    else if (code === 'KeyT') this.testDrive();
    else if (code === 'KeyH') this.toggleHelp();
    else if (/^Digit[1-9]$/.test(code)) { const list = BLOCK_IDS.filter((id) => BLOCKS[id].cat === this.cat); const t = list[+code.slice(5) - 1]; if (t) this.choose(t); }
    else if (code === 'Tab') { e.preventDefault(); const i = CATS.findIndex(([c]) => c === this.cat); this.cat = CATS[(i + (e.shiftKey ? CATS.length - 1 : 1)) % CATS.length][0]; this.renderPalette(); }
  }

  // fly the camera with the held keys
  fly(dt) {
    const k = this.keys;
    if (!k.size) return;
    const c = this.view.cam;
    const speed = (45 + c.pos.y * 0.9) * dt;
    const fwd = new THREE.Vector3(Math.sin(c.yaw), 0, Math.cos(c.yaw));
    const left = new THREE.Vector3(Math.cos(c.yaw), 0, -Math.sin(c.yaw));
    const mv = new THREE.Vector3();
    if (k.has('KeyW') || k.has('ArrowUp')) mv.add(fwd);
    if (k.has('KeyS') || k.has('ArrowDown')) mv.sub(fwd);
    if (k.has('KeyA') || k.has('ArrowLeft')) mv.add(left);
    if (k.has('KeyD') || k.has('ArrowRight')) mv.sub(left);
    if (mv.lengthSq()) c.pos.addScaledVector(mv.normalize(), speed);
    if (k.has('Space')) c.pos.y += speed * 0.8;
    if (k.has('ShiftLeft') || k.has('ShiftRight')) c.pos.y -= speed * 0.8;
    c.pos.y = Math.max(3, Math.min(600, c.pos.y));
    const lim = (BL.span + 10) * TILE;
    c.pos.x = Math.max(-lim, Math.min(lim, c.pos.x));
    c.pos.z = Math.max(-lim, Math.min(lim, c.pos.z));
  }

  // look at the whole track
  frame(instant = false) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y1 = 0;
    for (const b of this.blocks) for (const [x, y, z] of blockCells(b)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); y1 = Math.max(y1, y); }
    if (!isFinite(x0)) { x0 = x1 = z0 = z1 = 0; }
    const cx = ((x0 + x1) / 2) * TILE, cz = ((z0 + z1) / 2) * TILE;
    const size = Math.max((x1 - x0 + 1) * TILE, (z1 - z0 + 1) * TILE, 120);
    const yaw = this.view.cam.yaw, pitch = 0.85;
    const dist = size * 0.95 + 50;
    const pos = new THREE.Vector3(cx - Math.sin(yaw) * Math.cos(pitch) * dist, y1 * LAYER + Math.sin(pitch) * dist, cz - Math.cos(yaw) * Math.cos(pitch) * dist);
    if (instant) { this.view.cam.pos.copy(pos); this.view.cam.pitch = pitch; } else this.view.glide(pos, yaw, pitch);
  }

  flyTo(p) {
    const c = this.view.cam;
    const tgt = new THREE.Vector3(p.x * TILE, BASE_H + p.y * LAYER, p.z * TILE);
    const pitch = 0.75, dist = 90;
    this.view.glide(tgt.clone().add(new THREE.Vector3(-Math.sin(c.yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, -Math.cos(c.yaw) * Math.cos(pitch) * dist)), c.yaw, pitch);
  }

  // ---- AI test -----------------------------------------------------------------------------------
  renderAI() {
    const el = this.aiEl;
    clear(el);
    const m = this.meta.medals;
    if (this.verifier) {
      el.append(h('div.ai-run', h('span', 'AI driving…'), h('div.ai-bar', h('i', { style: { transform: `scaleX(${this.verifier.progress.toFixed(3)})` } })), button('Stop', () => { this.verifier = null; this.renderAI(); }, 'tiny ghost')));
      return;
    }
    el.append(button([icon('robot'), h('span', m ? 'AI test again' : 'AI test')], () => this.runAI(), 'small', { title: 'An AI driver races the track to prove it can be finished - and sets medal times' }));
    if (m) el.append(h('div.ai-medals', h('span', 'Medals'), ...['author', 'gold', 'silver', 'bronze'].map((k) => h('span.tdm', h('span.medal.' + k), formatTime(m[k])))));
    else if (this.aiNote) el.append(h('div.ai-note', this.aiNote));
  }

  runAI() {
    if (!this.route.ok) { this.ui.toast(this.route.errors[0]?.text || 'Finish the route first.', 'err'); return; }
    let v;
    try { v = new Verifier(buildDef(this.current()), { maxTime: 600 }); } catch (e) { this.ui.toast(e.message, 'err'); return; }
    this.verifier = v;
    this.aiNote = '';
    const layout = this.snapshot();
    const route = this.route;
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
        this.meta.medals = medalsFromTime(r.time);
        this.touch(false);
        this.ui.toast(`The AI finished in ${formatTime(r.time * 1000)} - medal times set.`);
      } else {
        const seg = r.trouble.map((p) => route.route.find((s) => p.piece >= s.p0 && p.piece < s.p1)).find(Boolean);
        this.aiNote = r.finished ? `The AI finished but was put back ${r.respawns}× - it flew to the first spot. Smooth that part out to earn medal times.` : 'The AI could not finish this track.';
        if (seg) this.flyTo(this.pointOf(this.blocks[seg.i]));
      }
      this.renderAI();
    };
    this.renderAI();
    setTimeout(slice, 30);
  }

  // ---- library, new, import, share, test drive ------------------------------------------------------
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
      const blocks = !!d.blocks;
      grid.append(h('div.lib-card' + (d.slot === this.slot ? '.on' : ''),
        d.routeOk !== false ? trackThumb(d, 220, 130) : h('div.lib-empty', 'Not raceable yet'),
        h('b', d.name), h('span', `${THEMES[d.theme]?.name || ''} · ${d.routeOk === false ? 'unfinished' : d.laps ? d.laps + ' laps' : 'Sprint'}${d.medals ? ' · AI tested' : ''}${blocks ? '' : ' · old builder'}`),
        h('div.row',
          blocks ? button('Open', () => { this.modalClose(); this.openDef(d, d.slot); }, 'tiny primary') : h('span.note', 'Race it from Play'),
          blocks ? button('Copy', () => { const c = saveToLibrary({ ...d, slot: undefined, name: (d.name + ' copy').slice(0, LIMITS.name) }); this.modalClose(); this.openDef(c, c.slot); }, 'tiny') : null,
          button('Delete', () => { if (!confirm(`Delete "${d.name}"? This can't be undone.`)) return; deleteFromLibrary(d.slot); if (d.slot === this.slot) { this.modalClose(); this.newTrack(); } else this.openLibrary(); }, 'tiny danger'))));
    }
    this.modalOpen('My tracks', list.length ? grid : h('p.note', 'No saved tracks yet.'), h('p.note', `${list.length} track${list.length === 1 ? '' : 's'} saved in this browser.`));
  }

  openDef(def, slot) {
    this.slot = slot;
    this.load(def);
    this.history = []; this.future = [];
    this.nameInput.value = this.meta.name;
    this.tab = 'track';
    this.layer = 0;
    this.refresh();
    this.renderSide();
    this.frame(true);
    this.renderAI();
    this.updateUndo();
    this.app.editorState = { def: this.current(), slot: this.slot };
  }

  newTrack() {
    const saved = saveToLibrary(blockDef(this.newMeta(), templateBlocks()));
    this.openDef(saved, saved.slot);
    this.ui.toast('New track started - it saves as you go.');
  }

  openImport() {
    const ta = h('textarea.ed-code', { placeholder: 'Paste a track code (PT1.…) or the contents of a .polytrack.json file', spellcheck: false, rows: 5 });
    const file = h('input', { type: 'file', accept: '.json,application/json,text/plain', style: { display: 'none' } });
    const msg = h('div.note');
    const take = async (text) => {
      try { this.importDef(await decodeShare(text)); } catch (e) { msg.textContent = e.message; msg.className = 'note err'; }
    };
    file.addEventListener('change', async () => { const f = file.files[0]; if (!f) return; if (f.size > 400000) { msg.textContent = 'That file is too big to be a track.'; return; } take(await f.text()); });
    this.modalOpen('Import a track', ta,
      h('div.row', button('Import code', () => take(ta.value), 'primary small'), button([icon('upload'), h('span', 'Open a file…')], () => file.click(), 'small'), file),
      msg, h('p.note', 'You can also drop a .polytrack.json file anywhere on this window.'));
    ta.focus();
  }

  importDef(def) {
    const have = library().find((d) => d.id === def.id);
    const saved = have || saveToLibrary({ ...def, slot: undefined });
    this.modalClose();
    if (!saved.blocks) { this.ui.toast(`Saved "${saved.name}" - it was made with the old builder, so race it from Play.`); return; }
    this.openDef(saved, saved.slot);
    this.ui.toast(have ? `You already have "${have.name}" - opened it` : `Imported "${saved.name}"`);
  }

  async openExport() {
    const def = this.current();
    const box = h('textarea.ed-code', { readonly: true, rows: 4, spellcheck: false }, 'Making a code…');
    const copy = button([icon('copy'), h('span', 'Copy code')], () => { box.select(); navigator.clipboard?.writeText(box.value).then(() => this.ui.toast('Track code copied'), () => document.execCommand?.('copy')); }, 'primary small');
    const dl = button([icon('download'), h('span', 'Download file')], () => {
      const blob = new Blob([JSON.stringify({ polytrack: 2, ...shareable(def) })], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: fileName(def) });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'small');
    this.modalOpen('Share this track', h('p.note', 'Send the code to a friend - they paste it into Import. Or save it as a file. In an online room, the host can pick it from their tracks and everyone gets it.'), box, h('div.row', copy, dl));
    try { box.value = await encodeShare(def); } catch (e) { box.value = 'Could not make a code: ' + e.message; }
  }

  testDrive() {
    if (!this.route.ok) {
      const e = this.route.errors[0];
      this.ui.toast(e?.text || 'Finish the route first.', 'err');
      if (e?.at) this.flyTo(this.pointOf(e.at));
      return;
    }
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
    this.fly(dt);
    this.view.update(dt);
    if (this.verifier && (this._aiT = (this._aiT || 0) + dt) > 0.2) { this._aiT = 0; this.renderAI(); }
  }

  destroy() {
    if (this._saveT) { clearTimeout(this._saveT); this.save(); }
    clearTimeout(this._ovT);
    this.verifier = null;
    document.removeEventListener('keydown', this._key);
    document.removeEventListener('keyup', this._keyUp);
    window.removeEventListener('blur', this._blur);
    this.view.dispose();
    if (this.ui.editor === this) this.ui.editor = null;
  }
}

function row(label, ctl, note) { return h('div.set-row', h('div.set-label', label, note ? h('small', note) : null), ctl); }

// drop a .polytrack.json anywhere while the editor is open
export function editorDrop(app) {
  window.addEventListener('dragover', (e) => { if (app.ui.editor) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    const ed = app.ui.editor;
    if (!ed) return;
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (!f || f.size > 400000) return;
    try { ed.importDef(await decodeShare(await f.text())); } catch (err) { app.ui.toast(err.message, 'err'); }
  });
}
