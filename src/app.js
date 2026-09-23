// Top level: owns the renderer, input, audio, UI and whichever mode is live
// (menu backdrop, garage, race). Also the persistence of profile, settings,
// records and ghosts.
import * as THREE from 'three';
import { Renderer } from './render/renderer.js';
import { Input } from './core/input.js';
import { AudioEngine } from './core/audio.js';
import { Session } from './game/session.js';
import { TRACKS, getTrackDef } from './track/tracks.js';
import { MEDALS } from './track/medals.js';
import { DEFAULT_CAR } from './car/model.js';
import { UI } from './ui/ui.js';
import { load, save } from './util/storage.js';
import { mulberry32 } from './util/math.js';
import { randomBotCar, BOT_NAMES } from './car/presets.js';

export const VERSION = '1.0.0';

export const DEFAULT_SETTINGS = {
  quality: 'auto', camera: 'chase', fov: 70, units: 'kmh', master: 0.8, music: 0.5, sfx: 0.8,
  showFps: false, ghost: true, touch: 'auto', shake: true, name: '',
};

// wait until the browser has painted (so a loading card is visible before heavy
// work); falls back to a timer because hidden tabs get no animation frames
export function afterPaint() {
  return new Promise((res) => {
    let done = false;
    const go = () => { if (!done) { done = true; res(); } };
    requestAnimationFrame(() => requestAnimationFrame(go));
    setTimeout(go, 80);
  });
}

export class App {
  constructor() {
    this.canvas = document.getElementById('game');
    this.settings = { ...DEFAULT_SETTINGS, ...load('settings', {}) };
    if (!['auto', 'low', 'medium', 'high', 'ultra'].includes(this.settings.quality)) this.settings.quality = 'auto';
    const params = new URLSearchParams(location.search);
    this.params = params;
    if (params.get('quality')) this.settings.quality = params.get('quality');
    this.profile = load('profile', null) || { name: '', car: { ...DEFAULT_CAR }, created: Date.now() };
    this.profile.car = { ...DEFAULT_CAR, ...this.profile.car };
    this.records = load('records', {});
    // 'auto' starts on high and steps down after a short benchmark in the menu;
    // the result is never saved, so every launch re-measures
    this.autoQ = { t: 0, frames: [], done: this.settings.quality !== 'auto' };
    this.renderer = new Renderer(this.canvas, this.effectiveQuality());
    this.input = new Input();
    this.audio = new AudioEngine(this.settings);
    this.ui = new UI(this);
    this.session = null;
    this.mode = 'boot';
    this.last = performance.now();
    this.fps = 60;
    this.frameTimes = [];
    this.net = null;
    window.addEventListener('resize', () => this.renderer.resize());
    this.input.on('pause', () => this.onPause());
    this.input.on('respawn', () => { if (this.mode === 'race' && this.session?.player && !this.session.paused) this.session.respawn(this.session.player); });
    this.input.on('restart', () => { if (this.mode === 'race' && this.session?.mode === 'timetrial' && !this.session.paused) this.restartRace(); });
    this.input.on('camera', () => {
      if (this.mode !== 'race' || !this.session) return;
      const m = this.session.camera.cycle();
      this.settings.camera = m;
      this.saveSettings();
      this.ui.toast(`Camera: ${m}`);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode === 'race' && this.session && !this.session.paused && this.session.mode !== 'online') this.onPause();
    });
  }

  saveSettings() { save('settings', this.settings); }

  effectiveQuality() {
    return this.settings.quality === 'auto' ? this.autoLevel || 'high' : this.settings.quality;
  }

  setQuality(q) {
    this.settings.quality = q;
    this.saveSettings();
    if (q === 'auto') { this.autoLevel = null; this.autoQ = { t: 0, frames: [], done: false }; }
    this.renderer.setQuality(this.effectiveQuality());
  }

  // measure the menu backdrop for a few seconds and step quality down if slow
  _autoQuality(dt) {
    const a = this.autoQ;
    if (a.done || this.mode !== 'menu' || document.hidden) return;
    a.t += dt;
    if (a.t < 1.5) return;
    a.frames.push(dt);
    if (a.t < 5) return;
    const fps = a.frames.length / a.frames.reduce((x, y) => x + y, 0);
    const cur = this.effectiveQuality();
    const order = ['low', 'medium', 'high'];
    let next = cur;
    if (fps < 34) next = 'low';
    else if (fps < 50) next = order[Math.max(0, order.indexOf(cur) - 1)];
    if (next !== cur) {
      this.autoLevel = next;
      this.renderer.setQuality(next);
      this.ui.toast(`Graphics set to ${next[0].toUpperCase() + next.slice(1)} for smoother play`);
      a.t = 0; a.frames = []; // re-check once at the new level
      if (next === 'low') a.done = true;
    } else a.done = true;
  }
  saveProfile() { save('profile', this.profile); }
  saveRecords() { save('records', this.records); }

  start() {
    const dev = this.params.get('dev');
    this.ui.boot(() => {
      if (dev === 'race') {
        this.startRace({ def: getTrackDef(this.params.get('track') || TRACKS[0].id), mode: this.params.get('mode') || 'timetrial', bots: +(this.params.get('bots') || 0) });
      } else if (dev === 'garage') {
        this.ui.show('garage');
      } else if (this.params.get('room')) {
        this.toMenu('online'); // invite link: straight to the join screen
      } else {
        this.toMenu();
      }
    });
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---- modes -------------------------------------------------------------------
  toMenu(screen = 'title') {
    this.endSession();
    this.mode = 'menu';
    this.ui.show(screen);
    this.audio.setMusic('menu');
    // build the backdrop race after the menu has painted
    const token = (this._menuToken = {});
    afterPaint().then(() => { if (this._menuToken === token && this.mode === 'menu' && !this.session) this.startDemo(); });
  }

  startDemo(trackId) {
    const pool = TRACKS.filter((t) => t.showcase !== false);
    const def = trackId ? getTrackDef(trackId) : pool[Math.floor(Math.random() * pool.length)];
    const rnd = mulberry32((Date.now() & 0xffff) + 7);
    const bots = [];
    for (let i = 0; i < 5; i++) bots.push({ name: BOT_NAMES[i], custom: randomBotCar(rnd), skill: 0.9 + rnd() * 0.1 });
    this.session = new Session(this, { def, mode: 'demo', laps: 99, bots, player: null });
    this.session.camera.setMode('orbit');
    this.session.countdown = 0.01;
    this.demoCam = { t: 0, target: 0, switchAt: 7 };
    this.session.focus = this.session.entries[0];
  }

  endSession() {
    if (this.session) { this.session.dispose(); this.session = null; }
    this.audio.stopEngines();
  }

  async startRace(opts) {
    this.endSession();
    this.mode = 'loading';
    this.ui.loading(opts.def);
    await afterPaint();
    const def = opts.def;
    const mode = opts.mode || 'timetrial';
    const rec = this.records[def.id];
    const ghostOn = this.settings.ghost && mode === 'timetrial';
    const ghost = ghostOn ? load('ghost.' + def.id, null) : null;
    const bots = [];
    if (mode === 'race') {
      const rnd = mulberry32(Date.now() & 0xffff);
      const n = opts.bots ?? 5;
      const skillBase = { easy: 0.72, medium: 0.83, hard: 0.92, pro: 1.0 }[opts.difficulty || 'medium'];
      for (let i = 0; i < n; i++) bots.push({ name: BOT_NAMES[(i + Math.floor(rnd() * 8)) % BOT_NAMES.length], custom: randomBotCar(rnd), skill: skillBase - rnd() * 0.05 + (i === 0 ? 0.03 : 0) });
    }
    this.lastRace = { ...opts, def, mode };
    this.session = new Session(this, {
      def, mode, laps: opts.laps, bots,
      player: { name: this.playerName(), custom: this.profile.car },
      ghost, pbSplits: rec?.splits || null, slot: mode === 'race' ? bots.length : 0,
      rubber: mode === 'race' && ['easy', 'medium'].includes(opts.difficulty || 'medium'),
    });
    this.mode = 'race';
    this.ui.loading(null);
    this.ui.show('hud');
    this.audio.setMusic(null);
    this.audio.startEngines(this.session);
  }

  restartRace() {
    if (!this.lastRace) return;
    this.startRace(this.lastRace);
  }

  quitRace() {
    this.ui.closeOverlay();
    if (this.net) {
      if (this.session?.mode === 'online' || this.ui.current === 'lobby') {
        this.net.leave();
        this.net = null;
      }
    }
    this.toMenu(this.lastRace && this.session?.mode !== 'online' ? 'play' : 'title');
  }

  openGarage(fromLobby = false) {
    this.endSession();
    this.mode = 'garage';
    this.garageReturn = fromLobby ? 'lobby' : 'title';
    this.ui.show('garage');
    this.audio.setMusic('menu');
  }

  closeGarage() {
    const back = this.garageReturn || 'title';
    this.garageReturn = null;
    if (back === 'lobby' && this.net) { this.net.updateCar(); this.toMenu('lobby'); }
    else this.toMenu('title');
  }

  // ---- online -------------------------------------------------------------------
  async startOnlineRace(m) {
    const net = this.net;
    if (!net) return;
    const def = getTrackDef(m.trackId);
    if (!def) return;
    const me = m.grid.find((g) => g.id === net.selfId);
    if (!me) { this.ui.toast('Race started without you - you will join the next one.'); return; }
    this.endSession();
    this.mode = 'loading';
    this.ui.loading(def);
    await afterPaint();
    if (this.net !== net) { this.ui.loading(null); return; }
    const bots = net.isHost ? m.grid.filter((g) => g.kind === 'bot').map((g) => ({ id: g.id, name: g.name, custom: g.car, skill: g.skill, slot: g.slot })) : [];
    const remotes = m.grid.filter((g) => g.id !== net.selfId && (g.kind === 'player' || !net.isHost)).map((g) => ({ id: g.id, name: g.name, custom: g.car, slot: g.slot }));
    this.endSession();
    this.lastRace = null;
    this.session = new Session(this, {
      def, mode: 'online', laps: m.laps, bots, remotes,
      player: { name: this.playerName(), custom: this.profile.car }, playerId: net.selfId, slot: me.slot,
    });
    this.session.startAt = m.startAt;
    this.mode = 'race';
    this.ui.loading(null);
    this.ui.show('hud');
    this.audio.setMusic(null);
    this.audio.startEngines(this.session);
  }

  onNetLobby() {
    this.toMenu('lobby');
  }

  onNetClosed(reason) {
    this.net = null;
    this.toMenu('online');
    this.ui.toast(reason || 'Disconnected', 'err');
  }

  playerName() { return (this.profile.name || '').trim() || 'Player'; }

  onPause() {
    if (this.mode !== 'race' || !this.session) return;
    if (this.ui.current === 'results') return;
    if (this.session.mode === 'online') { this.ui.togglePause(); return; }
    const p = !this.session.paused;
    this.session.paused = p;
    this.audio.setPaused(p);
    if (p) this.ui.overlay('pause'); else this.ui.closeOverlay();
  }

  resume() {
    if (this.session) { this.session.paused = false; this.audio.setPaused(false); }
    this.ui.closeOverlay();
  }

  // ---- race events -------------------------------------------------------------
  handleEvents() {
    const s = this.session;
    for (const ev of s.takeEvents()) {
      switch (ev.type) {
        case 'count': this.audio.beep(ev.n); this.ui.hud?.countdown(ev.n); break;
        case 'go': this.audio.beep(0); this.ui.hud?.countdown(0); break;
        case 'checkpoint': this.audio.play('checkpoint'); this.ui.hud?.split(ev.time, ev.delta, 'CHECKPOINT'); break;
        case 'lap': this.audio.play('lap'); this.ui.hud?.split(ev.time, ev.delta, `LAP ${ev.lap}`); break;
        case 'boost': if (ev.id === s.focus?.id) this.audio.play('boost'); break;
        case 'respawn': if (ev.id === s.player?.id) this.audio.play('respawn'); break;
        case 'finish': this.onFinish(ev); break;
        default: break;
      }
      this.net?.onSessionEvent?.(ev);
    }
  }

  onFinish(ev) {
    const s = this.session;
    const def = s.opts.def;
    this.audio.play('finish');
    if (s.player?.car) s.effects.confetti(s.player.car.pos, s.player.car.vel);
    const ms = Math.round(ev.time * 1000);
    let pb = false;
    if (s.mode === 'timetrial' || s.mode === 'race') {
      const rec = this.records[def.id] || {};
      const key = s.laps && s.laps !== def.laps ? 'bestL' + s.laps : 'best';
      if (rec[key] == null || ms < rec[key]) {
        pb = true;
        rec[key] = ms;
        if (key === 'best') {
          rec.splits = ev.splits;
          const gd = s.ghostData();
          if (gd) save('ghost.' + def.id, gd);
        }
        rec.date = Date.now();
      }
      rec.runs = (rec.runs || 0) + 1;
      this.records[def.id] = rec;
      this.saveRecords();
    }
    s.autopilot = true;
    const medal = s.mode === 'online' ? null : medalFor(def.id, ms);
    this.lastResult = { time: ms, pb, medal, trackId: def.id, mode: s.mode, delta: ev.delta };
    setTimeout(() => { if (this.session === s) this.showResults(); }, s.mode === 'timetrial' ? 1800 : 2600);
  }

  showResults() {
    this.ui.show('results', this.lastResult);
  }

  // ---- main loop ------------------------------------------------------------------
  frame(t) {
    requestAnimationFrame((tt) => this.frame(tt));
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    this.tick(dt);
  }

  tick(dt) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 30) this.frameTimes.shift();
    this.fps = this.frameTimes.length / this.frameTimes.reduce((a, b) => a + b, 0);
    this.input.pollPad();
    this._autoQuality(dt);
    const inp = this.input.state();
    if (this.mode === 'garage' && this.ui.garage) {
      this.ui.garage.update(dt);
    } else if (!this.session) {
      this.renderer.renderer.setClearColor(0x0b101b, 1);
      this.renderer.renderer.clear();
    } else if (this.session) {
      this.session.update(dt, inp);
      if (this.mode === 'menu') this._demoDirector(dt);
      if (this.mode === 'race') this.handleEvents();
      if (this.net) this.net.tick(dt);
      this.audio.update(this.session, dt, inp);
      this.renderer.render();
    }
    this.ui.update(dt);
  }

  // cut between bots in the menu backdrop like a TV director
  _demoDirector(dt) {
    const s = this.session, d = this.demoCam;
    d.t += dt;
    if (d.t > d.switchAt) {
      d.t = 0;
      d.switchAt = 6 + Math.random() * 5;
      const others = s.entries.filter((e) => e !== s.focus);
      s.focus = others[Math.floor(Math.random() * others.length)] || s.focus;
      s._attachHeadlight();
      const modes = ['orbit', 'chase', 'far', 'orbit'];
      const m = modes[Math.floor(Math.random() * modes.length)];
      s.camera.setMode(m);
      if (m === 'orbit') { s.camera.orbit.radius = 9 + Math.random() * 6; s.camera.orbit.height = 2 + Math.random() * 3; s.camera.orbit.speed = (Math.random() < 0.5 ? -1 : 1) * (0.15 + Math.random() * 0.2); }
      s.camera.snap(s._camTarget(s.focus));
    }
  }

  devHandle() {
    const app = this;
    return {
      app, THREE,
      // advance the game by n frames of dt without rAF (for headless capture);
      // only the last frame is rendered unless every=true
      step(n = 1, dt = 1 / 60, every = false) {
        const r = app.renderer.render;
        for (let i = 0; i < n; i++) {
          if (!every && i < n - 1) app.renderer.render = () => {};
          app.tick(dt);
          app.renderer.render = r;
        }
      },
      async shot(name) {
        app.renderer.render();
        const url = app.canvas.toDataURL('image/png');
        await fetch('/__shot?name=' + encodeURIComponent(name), { method: 'POST', body: url });
        return name;
      },
      tracks: TRACKS,
    };
  }
}

export function medalFor(trackId, ms) {
  const m = MEDALS[trackId];
  if (!m) return null;
  if (ms <= m.author) return 'author';
  if (ms <= m.gold) return 'gold';
  if (ms <= m.silver) return 'silver';
  if (ms <= m.bronze) return 'bronze';
  return null;
}
