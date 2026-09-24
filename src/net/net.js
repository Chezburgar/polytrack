// Room + race protocol on top of a transport. The host is authoritative for
// the lobby (roster, settings, start time, bots) and relays every message; each
// client simulates only its own car and streams snapshots stamped with race
// time, so remote cars are interpolated on the shared race clock.
import { PeerTransport, LocalTransport } from './transport.js';
import { TRACKS } from '../track/tracks.js';
import { sanitize, shareable } from '../track/custom.js';
import { BOT_NAMES, randomBotCar } from '../car/presets.js';
import { mulberry32 } from '../util/math.js';
import { INTRO_LENGTH } from '../game/intro.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MAX_PLAYERS = 8;
const SEND_HZ = 20;

export function makeCode(rnd = Math.random) {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(rnd() * CODE_CHARS.length)];
  return s;
}

export class NetSession {
  constructor(app) {
    this.app = app;
    this.players = new Map();
    this.settings = { trackId: TRACKS[0].id, laps: TRACKS[0].laps || 0, bots: 0, difficulty: 'medium' };
    this.state = 'idle';
    this.chatLog = [];
    this.listeners = new Set();
    this.offset = 0;
    this.bestRtt = Infinity;
    this.rttSamples = [];
    this.finishes = new Map();
    this.sendAcc = 0;
    this.chatTimes = new Map(); // host: recent message times per player (spam limit)
  }

  // ---- lifecycle ------------------------------------------------------------------
  async create({ local = false } = {}) {
    let lastErr = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeCode();
      const tr = local ? new LocalTransport() : new PeerTransport();
      try {
        await tr.host(code);
        this.t = tr;
        this.code = code;
        break;
      } catch (e) {
        lastErr = e;
        tr.close();
        if (e.type !== 'unavailable-id') throw friendly(e);
      }
    }
    if (!this.t) throw friendly(lastErr);
    this.role = 'host';
    this.local = local;
    this.selfId = this.t.selfId;
    this.players.set(this.selfId, this._me(true));
    this._assignSlots();
    this.t.on('data', (id, m) => this._hostData(id, m));
    this.t.on('leave', (id) => this._drop(id));
    this.state = 'lobby';
    this.pingTimer = setInterval(() => this._hostTick(), 2000);
    this._changed();
    return this.code;
  }

  async join(code, { local = false } = {}) {
    code = code.trim().toUpperCase();
    const tr = local ? new LocalTransport() : new PeerTransport();
    try { await tr.join(code); } catch (e) { tr.close(); throw friendly(e); }
    this.t = tr;
    this.code = code;
    this.role = 'guest';
    this.local = local;
    this.selfId = tr.selfId;
    tr.on('data', (id, m) => this._guestData(m));
    tr.on('close', (reason) => this._closed(reason));
    const me = this._me(false);
    tr.toHost({ t: 'hello', name: me.name, car: me.car, v: 1 });
    await new Promise((resolve, reject) => {
      this._welcomed = resolve;
      setTimeout(() => reject(new Error('The room did not answer.')), 8000);
    });
    this.pingTimer = setInterval(() => this.t.toHost({ t: 'ping', c: performance.now() }), 1500);
    this.t.toHost({ t: 'ping', c: performance.now() });
    return code;
  }

  leave() {
    clearInterval(this.pingTimer);
    this.t?.close();
    this.t = null;
    this.state = 'idle';
    this.players.clear();
  }

  _me(host) {
    const p = this.app.profile;
    return { id: this.selfId, name: this.app.playerName(), car: { ...p.car }, ready: host, host, ping: 0, slot: 0 };
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _changed(kind = 'update', data) { for (const fn of this.listeners) fn(kind, data); }

  now() { return performance.now() + this.offset; }

  get isHost() { return this.role === 'host'; }
  get me() { return this.players.get(this.selfId); }
  list() { return [...this.players.values()].sort((a, b) => a.slot - b.slot); }

  // ---- host side ----------------------------------------------------------------------
  _hostData(id, m) {
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'hello': {
        if (this.players.size >= MAX_PLAYERS) { this.t.send(id, { t: 'full' }); setTimeout(() => this.t.kick(id), 300); return; }
        const p = { id, name: clean(m.name) || 'Guest', car: m.car || {}, ready: false, host: false, ping: 0, slot: 0 };
        this.players.set(id, p);
        this._assignSlots();
        this.t.send(id, { t: 'welcome', you: id, players: this.list(), settings: this.settings, state: this.state, code: this.code });
        this._broadcastRoster();
        this._sysChat(`${p.name} joined`);
        this.app.audio.play('join');
        break;
      }
      case 'ping': this.t.send(id, { t: 'pong', c: m.c, h: performance.now() }); break;
      case 'rtt': { const p = this.players.get(id); if (p) p.ping = Math.round(m.ms); break; }
      case 'ready': { const p = this.players.get(id); if (p) { p.ready = !!m.ready; this._broadcastRoster(); } break; }
      case 'car': { const p = this.players.get(id); if (p) { p.car = m.car || p.car; p.name = clean(m.name) || p.name; this._broadcastRoster(); } break; }
      case 'chat': this._relayChat(id, m.text); break;
      case 's': this.t.broadcast(m, id); this._remoteState(m); break;
      case 'fin': this._finish(m.id || id, m.time); break;
      default: break;
    }
  }

  _hostTick() {
    this._broadcastRoster();
    // end the race once everyone is in, or 30 s after the first finisher
    if (this.state === 'racing' && this.firstFinishAt && (performance.now() - this.firstFinishAt > 30000 || this._allFinished())) this.endRace();
  }

  _assignSlots() {
    const used = new Set();
    for (const p of this.players.values()) {
      if (p.slot != null && !used.has(p.slot) && p._slotted) { used.add(p.slot); continue; }
      let s = 0;
      while (used.has(s)) s++;
      p.slot = s; p._slotted = true;
      used.add(s);
    }
  }

  _broadcastRoster() {
    this.t?.broadcast({ t: 'roster', players: this.list(), state: this.state });
    this._changed();
  }

  _drop(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this._broadcastRoster();
    this._sysChat(`${p.name} left`);
    this.app.audio.play('leave');
    this.t.broadcast({ t: 'gone', id });
    this._changed('gone', id);
    if (this.state === 'racing' && this._allFinished()) this.endRace();
  }

  // trackId takes a built-in id or a custom track definition (from the host's
  // library); a custom track's pieces travel with the settings
  setSetting(k, v) {
    if (!this.isHost) return;
    if (k === 'trackId') {
      const def = typeof v === 'object' && v ? v : TRACKS.find((t) => t.id === v);
      if (!def) return;
      this.settings.trackId = def.id;
      this.settings.custom = def.custom ? shareable(def) : null;
      this.settings.laps = def.laps || 0;
    } else this.settings[k] = v;
    this.t.broadcast({ t: 'settings', settings: this.settings });
    this._changed();
    if (k === 'trackId') { const d = this.trackDef(); if (d) this._sysChat(`Track: ${d.name}${d.custom ? ' (custom)' : ''}`); }
  }

  // the chosen track's definition; custom ones are checked before use (a guest
  // never trusts what arrives over the wire)
  trackDef() {
    const s = this.settings;
    if (s.custom) {
      if (this._cdef?.src !== s.custom) {
        let def = null;
        try { def = sanitize(s.custom); } catch (e) { console.warn('bad custom track', e); }
        this._cdef = { src: s.custom, def };
      }
      return this._cdef.def;
    }
    return TRACKS.find((t) => t.id === s.trackId) || null;
  }

  kick(id) {
    if (!this.isHost || id === this.selfId) return;
    this.t.send(id, { t: 'kicked' });
    setTimeout(() => { this.t.kick(id); this._drop(id); }, 200);
  }

  startRace() {
    if (!this.isHost || this.state === 'racing') return;
    const def = this.trackDef() || TRACKS[0];
    const grid = this.list().map((p) => ({ id: p.id, name: p.name, car: p.car, kind: 'player', slot: p.slot }));
    const rnd = mulberry32(Date.now() & 0xffff);
    const skill = { easy: 0.8, medium: 0.9, hard: 0.96, pro: 1 }[this.settings.difficulty] || 0.9;
    let slot = grid.length;
    for (let i = 0; i < Math.min(this.settings.bots, MAX_PLAYERS - grid.length); i++) {
      grid.push({ id: 'bot' + i, name: BOT_NAMES[(i * 3 + 5) % BOT_NAMES.length] + ' (AI)', car: randomBotCar(rnd), kind: 'bot', slot: slot++, skill: skill - rnd() * 0.04 });
    }
    // with the pre-race intro on, the start moves back to make room for it
    const intro = !!this.app.introOn?.();
    const msg = { t: 'start', trackId: def.id, def: def.custom ? shareable(def) : null, laps: def.laps ? this.settings.laps || def.laps : 0, grid, intro, startAt: this.now() + 5200 + (intro ? INTRO_LENGTH * 1000 : 0) };
    this.t.broadcast(msg);
    this._begin(msg);
  }

  endRace() {
    if (!this.isHost || this.state !== 'racing') return;
    this.state = 'results';
    const msg = { t: 'end', finishes: [...this.finishes.entries()] };
    this.t.broadcast(msg);
    // the result goes in the chat too
    const best = [...this.finishes.entries()].sort((a, b) => a[1] - b[1])[0];
    const who = best && (this.race?.grid || []).find((g) => g.id === best[0]);
    if (who) this._sysChat(`${who.name} won in ${fmt(best[1])}`);
    this._changed('end');
    this._broadcastRoster();
  }

  backToLobby() {
    if (!this.isHost) return;
    this.state = 'lobby';
    for (const p of this.players.values()) p.ready = p.host;
    this.t.broadcast({ t: 'lobby' });
    this._broadcastRoster();
    this.app.onNetLobby();
  }

  // ---- guest side -----------------------------------------------------------------------
  _guestData(m) {
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'welcome':
        this.selfId = m.you;
        this._setRoster(m.players);
        this.settings = m.settings;
        this.state = m.state === 'racing' ? 'waiting' : 'lobby';
        this._welcomed?.();
        this._changed();
        break;
      case 'full': this._closed('That room is full (8 players).'); break;
      case 'kicked': this._closed('You were removed from the room by the host.'); break;
      case 'roster': this._setRoster(m.players); if (m.state === 'lobby' && this.state === 'waiting') this.state = 'lobby'; this._changed(); break;
      case 'settings': this.settings = m.settings; this._changed(); break;
      case 'pong': {
        const now = performance.now();
        const rtt = now - m.c;
        this.rttSamples.push({ rtt, off: m.h + rtt / 2 - now });
        if (this.rttSamples.length > 12) this.rttSamples.shift();
        const best = this.rttSamples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
        this.offset = best.off;
        this.t.toHost({ t: 'rtt', ms: rtt });
        break;
      }
      case 'chat': this._pushChat(m); break;
      case 'start': this._begin(m); break;
      case 's': this._remoteState(m); break;
      case 'fin': this._finish(m.id, m.time, true); break;
      case 'gone': this._changed('gone', m.id); this.app.session?.removeEntry(m.id); break;
      case 'end': this.state = 'results'; for (const [id, t] of m.finishes) this.finishes.set(id, t); this._changed('end'); break;
      case 'lobby': this.state = 'lobby'; this.app.onNetLobby(); this._changed(); break;
      default: break;
    }
  }

  _setRoster(list) {
    const mine = this.players.get(this.selfId);
    this.players.clear();
    for (const p of list) this.players.set(p.id, p);
    if (mine && !this.players.has(this.selfId)) this.players.set(this.selfId, mine);
  }

  _closed(reason) {
    if (this.state === 'idle') return;
    this.leave();
    this.app.onNetClosed(reason);
  }

  // ---- shared -----------------------------------------------------------------------------
  setReady(r) {
    const me = this.me;
    if (me) me.ready = r;
    if (this.isHost) this._broadcastRoster(); else { this.t.toHost({ t: 'ready', ready: r }); this._changed(); }
  }

  updateCar() {
    const me = this.me;
    if (!me) return;
    me.car = { ...this.app.profile.car };
    me.name = this.app.playerName();
    if (this.isHost) this._broadcastRoster(); else this.t.toHost({ t: 'car', car: me.car, name: me.name });
  }

  chat(text) {
    text = clean(text, 140);
    if (!text) return;
    if (this.isHost) this._relayChat(this.selfId, text);
    else this.t.toHost({ t: 'chat', text });
  }

  _relayChat(id, text) {
    // at most 5 messages in 5 seconds each
    const now = performance.now();
    const times = (this.chatTimes.get(id) || []).filter((x) => now - x < 5000);
    if (times.length >= 5) {
      const warn = { t: 'chat', sys: true, text: 'Slow down - too many messages.' };
      if (id === this.selfId) this._pushChat(warn); else this.t.send(id, warn);
      return;
    }
    times.push(now);
    this.chatTimes.set(id, times);
    const p = this.players.get(id);
    const m = { t: 'chat', from: id, name: p?.name || '?', text: clean(text, 140), color: p?.car?.paint };
    this.t.broadcast(m);
    this._pushChat(m);
  }

  _sysChat(text) {
    const m = { t: 'chat', sys: true, text };
    this.t.broadcast(m);
    this._pushChat(m);
  }

  _pushChat(m) {
    this.chatLog.push(m);
    if (this.chatLog.length > 60) this.chatLog.shift();
    if (!m.sys && m.from !== this.selfId) this.app.audio.play('chat');
    this._changed('chat', m);
  }

  _begin(m) {
    this.state = 'racing';
    this.finishes.clear();
    this.firstFinishAt = null;
    this.race = m;
    this.app.startOnlineRace(m);
    this._changed('start');
  }

  _remoteState(m) {
    this.app.session?.remoteSnapshot?.(m.id, m);
  }

  _finish(id, time, fromHost = false) {
    if (this.finishes.has(id)) return;
    this.finishes.set(id, time);
    if (this.isHost) {
      if (!this.firstFinishAt) this.firstFinishAt = performance.now();
      this.t.broadcast({ t: 'fin', id, time });
      if (this._allFinished()) setTimeout(() => this.endRace(), 1500);
    }
    this.app.session?.remoteFinish?.(id, time);
    this._changed('fin', { id, time, fromHost });
  }

  _allFinished() {
    const g = this.race?.grid || [];
    return g.every((p) => this.finishes.has(p.id) || (!this.players.has(p.id) && p.kind === 'player'));
  }

  // called by the app every frame during an online race
  tick(dt) {
    const s = this.app.session;
    if (!s || this.state !== 'racing' || !this.t) return;
    this.sendAcc += dt;
    if (this.sendAcc < 1 / SEND_HZ) return;
    this.sendAcc = 0;
    const send = (e) => {
      const c = e.car;
      const msg = {
        t: 's', id: e.id, ts: +s.time.toFixed(3),
        p: [r3(c.pos.x), r3(c.pos.y), r3(c.pos.z)],
        q: [r4(c.quat.x), r4(c.quat.y), r4(c.quat.z), r4(c.quat.w)],
        v: [r2(c.vel.x), r2(c.vel.y), r2(c.vel.z)],
        st: r2(c.steer), b: c.boost > 0 ? 1 : 0, c: +(e.completion || 0).toFixed(5), l: e.race.lap,
        g: e.ghostUntil > s.clock ? 1 : 0,
      };
      if (this.isHost) this.t.broadcast(msg); else this.t.toHost(msg);
    };
    if (s.player?.car) send(s.player);
    if (this.isHost) for (const e of s.entries) if (e.kind === 'bot') send(e);
  }

  // session events from the local race
  onSessionEvent(ev) {
    if (ev.type === 'finish') {
      const msg = { t: 'fin', id: this.selfId, time: ev.time };
      if (this.isHost) this._finish(this.selfId, ev.time); else { this.t.toHost(msg); this.finishes.set(this.selfId, ev.time); this._changed('fin', { id: this.selfId, time: ev.time }); }
    }
    if (ev.type === 'otherFinish' && this.isHost && ev.id.startsWith('bot')) this._finish(ev.id, ev.time);
  }
}

const r2 = (v) => Math.round(v * 100) / 100;
const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`;
const r3 = (v) => Math.round(v * 1000) / 1000;
const r4 = (v) => Math.round(v * 10000) / 10000;

function clean(s, max = 16) {
  return String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
}

function friendly(e) {
  if (!e) return new Error('Could not connect.');
  const map = {
    'browser-incompatible': 'This browser does not support WebRTC multiplayer.',
    network: 'Could not reach the matchmaking server. Check your connection (school networks sometimes block it).',
    'server-error': 'The matchmaking server is unavailable right now. Try again in a minute.',
    'socket-error': 'Lost the connection to the matchmaking server.',
    'unavailable-id': 'Could not get a room code. Try again.',
    'not-found': e.message,
    timeout: e.message,
    webrtc: 'The connection between players failed (a firewall may be blocking peer-to-peer).',
  };
  const out = new Error(map[e.type] || e.message || 'Could not connect.');
  out.type = e.type;
  return out;
}
