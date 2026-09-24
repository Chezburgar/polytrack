// Track select: grid of 20 tracks with thumbnails, medals and bests, and a
// detail panel to pick Time Trial or a race against AI.
import { h, icon, clear } from '../dom.js';
import { button } from '../ui.js';
import { TRACKS } from '../../track/tracks.js';
import { buildTrack } from '../../track/builder.js';
import { getTheme } from '../../track/themes.js';
import { MEDALS } from '../../track/medals.js';
import { drawTrack } from '../trackmap.js';
import { formatTime } from '../../util/math.js';
import { medalFor } from '../../app.js';
import { load, save } from '../../util/storage.js';
import { library, buildDef } from '../../track/custom.js';
import { THEMES } from '../../track/themes.js';

const built = new Map();
export function trackInfo(def) {
  if (!built.has(def.id)) {
    const t = buildTrack(def.custom ? buildDef(def) : def);
    const feats = new Set();
    for (const p of t.pieces) {
      if (p.type === 'LOOP') feats.add('loop');
      if (p.type === 'J') feats.add('jump');
      if (p.boost) feats.add('boost');
      if (p.surface === 'ice') feats.add('ice');
      if (p.surface === 'dirt' || p.surface === 'sand') feats.add('dirt');
      if (p.bank) feats.add('banked');
      if (p.tunnel) feats.add('tunnel');
    }
    built.set(def.id, { track: t, feats: [...feats] });
  }
  return built.get(def.id);
}

export function trackThumb(def, w = 240, h2 = 150) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h2;
  const ctx = c.getContext('2d');
  const th = getTheme(def.theme);
  const g = ctx.createLinearGradient(0, 0, w, h2);
  g.addColorStop(0, hex(th.sky.top));
  g.addColorStop(1, hex(th.groundColors?.[0] ?? th.sky.bottom));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h2);
  ctx.fillStyle = 'rgba(8,12,20,0.35)';
  ctx.fillRect(0, 0, w, h2);
  drawTrack(ctx, trackInfo(def).track, w, h2, { pad: 14, width: 4 });
  return c;
}
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

export const DIFFICULTY = ['Easy', 'Medium', 'Hard', 'Expert'];
export const MEDAL_NAMES = { author: 'Author', gold: 'Gold', silver: 'Silver', bronze: 'Bronze' };

export function medalIcon(m, big = false) {
  return h('span.medal.' + (m || 'none') + (big ? '.big' : ''), { title: m ? MEDAL_NAMES[m] : 'No medal' });
}

export class PlayScreen {
  constructor(ui) {
    this.ui = ui;
    const app = (this.app = ui.app);
    this.filter = 'all';
    this.prefs = { mode: 'timetrial', bots: 5, difficulty: 'medium', laps: null, ...load('playPrefs', {}) };
    this.custom = library().filter((d) => d.routeOk !== false); // unfinished tracks stay in the builder
    this.selected = TRACKS.find((t) => t.id === this.prefs.track) || this.custom.find((t) => t.id === this.prefs.track) || TRACKS[0];
    if (this.selected.custom) this.filter = 'custom';
    this.grid = h('div.track-grid');
    this.detail = h('div.track-detail');
    const tabs = h('div.tabs', ...[['all', 'All'], ['sprint', 'Sprints'], ['circuit', 'Circuits'], ['custom', `My tracks (${this.custom.length})`]].map(([k, label]) =>
      h('button.tab' + (k === this.filter ? '.on' : ''), { type: 'button', onclick: (e) => {
        this.filter = k; tabs.querySelectorAll('.tab').forEach((t) => t.classList.remove('on')); e.currentTarget.classList.add('on');
        // switching to your tracks shows one of them
        if (k === 'custom' && !this.selected.custom && this.custom.length) { this.selected = this.custom[0]; this.renderDetail(); }
        this.renderGrid();
      } }, label)));
    const medals = TRACKS.map((t) => (app.records[t.id]?.best != null ? medalFor(t.id, app.records[t.id].best) : null));
    const count = (m) => medals.filter((x) => x === m).length;
    this.el = h('div.screen.play-screen',
      h('div.screen-head',
        button([icon('back')], () => this.back(), 'icon-btn'),
        h('h1', 'Select Track'),
        tabs,
        h('div.medal-summary', medalIcon('author'), count('author'), medalIcon('gold'), count('gold'), medalIcon('silver'), count('silver'), medalIcon('bronze'), count('bronze')),
      ),
      h('div.play-body', this.grid, this.detail),
    );
    this.renderGrid();
    this.renderDetail();
  }

  back() { this.app.audio.play('back'); this.ui.show('title'); }

  renderGrid() {
    clear(this.grid);
    if (this.filter === 'custom') { this.renderCustom(); return; }
    TRACKS.forEach((def, i) => {
      if (this.filter === 'sprint' && def.laps) return;
      if (this.filter === 'circuit' && !def.laps) return;
      const rec = this.app.records[def.id];
      const m = rec?.best != null ? medalFor(def.id, rec.best) : null;
      const card = h('button.track-card' + (def === this.selected ? '.sel' : ''), {
        type: 'button',
        onclick: () => { this.selected = def; this.app.audio.play('click'); this.renderGrid(); this.renderDetail(); },
        ondblclick: () => this.start(),
      },
      h('div.tc-thumb', trackThumb(def)),
      h('div.tc-num', String(i + 1).padStart(2, '0')),
      h('div.tc-info',
        h('div.tc-name', def.name),
        h('div.tc-meta', h('span', getTheme(def.theme).name), h('span.tc-type', def.laps ? `${def.laps} laps` : 'Sprint')),
        h('div.tc-best', medalIcon(m), rec?.best != null ? formatTime(rec.best) : '--:--.---'),
      ),
      h('div.tc-diff', ...[0, 1, 2, 3].map((k) => h('i' + (k <= (def.difficulty ?? 0) ? '.on' : '')))));
      this.grid.append(card);
    });
    this.grid.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }

  // the player's own tracks, plus a card to make a new one
  renderCustom() {
    this.grid.append(h('button.track-card.new-card', { type: 'button', onclick: () => { this.app.audio.play('select'); this.app.openEditor(); } },
      h('div.tc-thumb.new', icon('plus')), h('div.tc-info', h('div.tc-name', 'Track Builder'), h('div.tc-meta', h('span', 'Build your own - it saves here')))));
    for (const def of this.custom) {
      const rec = this.app.records[def.id];
      const m = rec?.best != null ? medalFor(def, rec.best) : null;
      const card = h('button.track-card' + (def.id === this.selected.id ? '.sel' : ''), {
        type: 'button',
        onclick: () => { this.selected = def; this.app.audio.play('click'); this.renderGrid(); this.renderDetail(); },
        ondblclick: () => this.start(),
      },
      h('div.tc-thumb', trackThumb(def)),
      h('div.tc-info',
        h('div.tc-name', def.name),
        h('div.tc-meta', h('span', THEMES[def.theme]?.name || ''), h('span.tc-type', def.laps ? `${def.laps} laps` : 'Sprint')),
        h('div.tc-best', medalIcon(m), rec?.best != null ? formatTime(rec.best) : '--:--.---')));
      this.grid.append(card);
    }
    this.grid.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }

  renderDetail() {
    const def = this.selected;
    const info = trackInfo(def);
    const t = info.track;
    const rec = this.app.records[def.id];
    const md = def.custom ? def.medals : MEDALS[def.id];
    const p = this.prefs;
    const laps = p.laps ?? def.laps;
    const modeBtn = (k, label, ic) => h('button.seg' + (p.mode === k ? '.on' : ''), { type: 'button', onclick: () => { p.mode = k; this.renderDetail(); } }, icon(ic), label);
    const featNames = { loop: 'Loops', jump: 'Jumps', boost: 'Boost pads', ice: 'Ice', dirt: 'Dirt', banked: 'Banked turns', tunnel: 'Tunnels' };
    const big = document.createElement('canvas');
    big.width = 360; big.height = 230;
    const bctx = big.getContext('2d');
    drawTrack(bctx, t, 360, 230, { pad: 18, width: 6 });
    clear(this.detail);
    // (h() skips nulls; the native append would print them)
    this.detail.append(h('div.td-body',
      h('div.td-map', big),
      h('div.td-title', h('h2', def.name), h('div.td-sub', `${getTheme(def.theme).name} · ${def.laps ? 'Circuit' : 'Sprint'} · ${(t.length / 1000).toFixed(2)} km · ${DIFFICULTY[def.difficulty ?? 0]}${def.custom && def.author ? ` · by ${def.author}` : ''}`)),
      def.custom && def.blocks ? h('div.row', button([icon('edit'), h('span', 'Edit in Track Builder')], () => { this.app.audio.play('select'); this.app.openEditor({ def, slot: def.slot }); }, 'small'), !md ? h('span.note', 'No medals yet - run the AI test in the builder.') : null) : null,
      h('div.td-feats', ...info.feats.map((f) => h('span.feat', featNames[f]))),
      md ? h('div.td-medals', ...['author', 'gold', 'silver', 'bronze'].map((m) => {
        const got = rec?.best != null && rec.best <= md[m];
        return h('div.tdm' + (got ? '.got' : ''), medalIcon(m), h('span', MEDAL_NAMES[m]), h('b', formatTime(md[m])));
      })) : null,
      h('div.td-best', h('span', 'Personal best'), h('b', rec?.best != null ? formatTime(rec.best) : '--:--.---')),
      h('div.segs', modeBtn('timetrial', 'Time Trial', 'clock'), modeBtn('race', 'Race vs AI', 'robot')),
      p.mode === 'race' ? h('div.opts',
        this.stepper('Opponents', p.bots, 1, 7, (v) => { p.bots = v; }),
        this.choice('Difficulty', ['easy', 'medium', 'hard', 'pro'], p.difficulty, (v) => { p.difficulty = v; }),
        def.laps ? this.stepper('Laps', laps, 1, 9, (v) => { p.laps = v; }) : null) : h('div.opts.hint', 'Race the clock. Your best run is saved as a ghost to chase.'),
      button([icon('flag'), h('span', 'Start')], () => this.start(), 'primary big wide'),
    ));
  }

  stepper(label, value, min, max, set) {
    const val = h('b', String(value));
    const upd = (d) => { value = Math.max(min, Math.min(max, value + d)); val.textContent = value; set(value); this.app.audio.play('click'); };
    return h('div.opt', h('span', label), h('div.stepper', h('button', { type: 'button', onclick: () => upd(-1) }, '−'), val, h('button', { type: 'button', onclick: () => upd(1) }, '+')));
  }

  choice(label, values, cur, set) {
    const wrap = h('div.choice');
    const render = () => {
      clear(wrap);
      for (const v of values) wrap.append(h('button' + (v === cur ? '.on' : ''), { type: 'button', onclick: () => { cur = v; set(v); render(); this.app.audio.play('click'); } }, v[0].toUpperCase() + v.slice(1)));
    };
    render();
    return h('div.opt', h('span', label), wrap);
  }

  start() {
    const p = this.prefs;
    p.track = this.selected.id;
    save('playPrefs', p);
    this.app.audio.play('select');
    const def = this.selected.custom ? buildDef(this.selected) : this.selected;
    this.app.startRace({ def, mode: p.mode, bots: p.bots, difficulty: p.difficulty, laps: def.laps ? p.laps ?? def.laps : 0 });
  }
}
