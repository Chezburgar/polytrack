// Audio: engines, tyres, wind and effects are synthesised with WebAudio (races
// only - the menu backdrop is silent apart from the music); the menu song and
// the pre-race intro's song stream from files (the old step-sequencer tune stays
// as a fallback if the menu song can't load). The context starts on the first
// user gesture (autoplay rules).
import { clamp } from '../util/math.js';

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
const MENU_SONG = 'assets/audio/menu-music.mp3';
// The pre-race intro plays one of these (never the menu), a different one from
// last time, cued so the moment it drops (s into the song) lands on the first racer.
export const INTRO_SONGS = [
  { url: 'assets/audio/menu-2.mp3', drop: 21 },
  { url: 'assets/audio/prerace-2.mp3', drop: 30 }, // the build that peaks at 31 s
];
const SONG_GAIN = 0.5; // the files are mastered loud; this sits them under the engines

export class AudioEngine {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.ready = false;
    this.engines = new Map(); // entry id -> voice
    this.musicTrack = null;
    this.paused = false;
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    window.addEventListener('touchstart', unlock, { capture: true });
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC({ latencyHint: 'interactive' });
      const c = this.ctx;
      this.master = c.createGain();
      this.comp = c.createDynamicsCompressor();
      this.comp.threshold.value = -14; this.comp.ratio.value = 4; this.comp.attack.value = 0.004; this.comp.release.value = 0.2;
      this.master.connect(this.comp).connect(c.destination);
      this.sfx = c.createGain(); this.sfx.connect(this.master);
      this.music = c.createGain(); this.music.connect(this.master);
      this.engineBus = c.createGain(); this.engineBus.connect(this.sfx);
      this.noiseBuf = this._noise(2);
      this.applyVolumes();
      this.ready = true;
      if (this.pendingMusic !== undefined) this.setMusic(this.pendingMusic);
      if (this.pendingEngines) { this.startEngines(this.pendingEngines); this.pendingEngines = null; }
    }
    if (this.ctx.state === 'suspended' && !this.paused) this.ctx.resume();
    // a play() refused before the gesture gets another go now
    if (this.musicTrack === 'menu' && this.song?.paused) this._playSong();
  }

  get running() { return !!this.ctx && this.ctx.state === 'running'; }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.master ?? 0.8, t, 0.05);
    this.sfx.gain.setTargetAtTime(s.sfx ?? 0.8, t, 0.05);
    this.music.gain.setTargetAtTime((s.music ?? 0.5) * 0.55, t, 0.05);
  }

  setPaused(p) {
    this.paused = p;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engineBus.gain.setTargetAtTime(p ? 0 : 1, t, 0.05);
  }

  _noise(seconds) {
    const c = this.ctx;
    const buf = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _noiseSrc() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.loopStart = Math.random();
    return s;
  }

  // ---- engine voices ----------------------------------------------------------
  _makeEngine(positional) {
    const c = this.ctx;
    const v = {};
    v.out = c.createGain();
    v.out.gain.value = 0;
    if (positional) {
      v.pan = c.createPanner();
      v.pan.panningModel = 'equalpower';
      v.pan.distanceModel = 'inverse';
      v.pan.refDistance = 8; v.pan.maxDistance = 400; v.pan.rolloffFactor = 1.3;
      v.out.connect(v.pan).connect(this.engineBus);
    } else v.out.connect(this.engineBus);
    v.filter = c.createBiquadFilter();
    v.filter.type = 'lowpass';
    v.filter.Q.value = 2.2;
    v.shaper = c.createWaveShaper();
    v.shaper.curve = distCurve(6);
    v.filter.connect(v.shaper).connect(v.out);
    v.o1 = c.createOscillator(); v.o1.type = 'sawtooth';
    v.o2 = c.createOscillator(); v.o2.type = 'sawtooth';
    v.o3 = c.createOscillator(); v.o3.type = 'square';
    v.g1 = c.createGain(); v.g2 = c.createGain(); v.g3 = c.createGain();
    v.g1.gain.value = 0.5; v.g2.gain.value = 0.35; v.g3.gain.value = 0.12;
    v.o1.connect(v.g1).connect(v.filter);
    v.o2.connect(v.g2).connect(v.filter);
    v.o3.connect(v.g3).connect(v.filter);
    // exhaust rumble: noise through a moving band-pass
    v.nz = this._noiseSrc();
    v.nf = c.createBiquadFilter(); v.nf.type = 'bandpass'; v.nf.Q.value = 1.2;
    v.ng = c.createGain(); v.ng.gain.value = 0;
    v.nz.connect(v.nf).connect(v.ng).connect(v.out);
    const t = c.currentTime;
    for (const o of [v.o1, v.o2, v.o3]) o.start(t);
    v.nz.start(t);
    if (!positional) {
      // tyres and wind only on the listener's car
      v.sq = this._noiseSrc();
      v.sqf = c.createBiquadFilter(); v.sqf.type = 'bandpass'; v.sqf.frequency.value = 2100; v.sqf.Q.value = 5;
      v.sqg = c.createGain(); v.sqg.gain.value = 0;
      v.sq.connect(v.sqf).connect(v.sqg).connect(this.sfx);
      v.sq.start(t);
      v.wind = this._noiseSrc();
      v.wf = c.createBiquadFilter(); v.wf.type = 'lowpass'; v.wf.frequency.value = 700;
      v.wg = c.createGain(); v.wg.gain.value = 0;
      v.wind.connect(v.wf).connect(v.wg).connect(this.sfx);
      v.wind.start(t);
      v.rough = this._noiseSrc();
      v.rf = c.createBiquadFilter(); v.rf.type = 'lowpass'; v.rf.frequency.value = 380;
      v.rg = c.createGain(); v.rg.gain.value = 0;
      v.rough.connect(v.rf).connect(v.rg).connect(this.sfx);
      v.rough.start(t);
    }
    v.positional = positional;
    return v;
  }

  _killVoice(v) {
    const t = this.ctx.currentTime;
    v.out.gain.setTargetAtTime(0, t, 0.05);
    for (const k of ['sqg', 'wg', 'rg']) v[k]?.gain.setTargetAtTime(0, t, 0.05);
    setTimeout(() => {
      for (const k of ['o1', 'o2', 'o3', 'nz', 'sq', 'wind', 'rough']) { try { v[k]?.stop(); } catch { /* already stopped */ } }
      v.out.disconnect();
      v.pan?.disconnect();
      for (const k of ['sqg', 'wg', 'rg']) v[k]?.disconnect();
    }, 300);
  }

  startEngines(session) {
    if (!this.ready) { this.pendingEngines = session; return; }
    this.stopEngines();
  }

  stopEngines() {
    if (!this.ctx) return;
    for (const v of this.engines.values()) this._killVoice(v);
    this.engines.clear();
  }

  // per-frame: keep the focus car's engine plus the three nearest others
  update(session, dt, input) {
    if (!this.ready || !session) return;
    const c = this.ctx;
    const t = c.currentTime;
    const cam = session.renderer.camera;
    const L = c.listener;
    if (L.positionX) {
      L.positionX.setTargetAtTime(cam.position.x, t, 0.02); L.positionY.setTargetAtTime(cam.position.y, t, 0.02); L.positionZ.setTargetAtTime(cam.position.z, t, 0.02);
      const f = cam.getWorldDirection(this._dir || (this._dir = cam.position.clone()));
      L.forwardX.setTargetAtTime(f.x, t, 0.02); L.forwardY.setTargetAtTime(f.y, t, 0.02); L.forwardZ.setTargetAtTime(f.z, t, 0.02);
      L.upX.setTargetAtTime(cam.up.x, t, 0.02); L.upY.setTargetAtTime(cam.up.y, t, 0.02); L.upZ.setTargetAtTime(cam.up.z, t, 0.02);
    }
    const focus = session.focus;
    const menu = session.mode === 'demo';
    const want = new Map();
    // the menu backdrop is silent (just the music); in a race: your car plus the nearest others
    if (menu) { for (const [id, v] of this.engines) { this._killVoice(v); this.engines.delete(id); } return; }
    if (focus) want.set(focus.id, { e: focus, positional: false });
    const others = session.entries.filter((e) => e !== focus && e.kind !== 'ghost')
      .map((e) => ({ e, d: e.model.group.position.distanceToSquared(cam.position) }))
      .sort((a, b) => a.d - b.d).slice(0, menu ? 2 : 3);
    for (const o of others) if (o.d < 250 * 250) want.set(o.e.id, { e: o.e, positional: true });
    for (const [id, v] of this.engines) if (!want.has(id)) { this._killVoice(v); this.engines.delete(id); }
    for (const [id, w] of want) {
      let v = this.engines.get(id);
      if (!v || v.positional !== w.positional) {
        if (v) this._killVoice(v);
        v = this._makeEngine(w.positional);
        this.engines.set(id, v);
      }
      this._drive(v, w.e, t, session, menu);
    }
  }

  _drive(v, e, t, session, menu = false) {
    const car = e.car;
    const speed = car ? car.speed : e.vel.length();
    let rpm = car ? car.rpm : 1200 + clamp(speed / 70, 0, 1) * 5800;
    let thr = car ? car.input.throttle : 0.7;
    if (session.state === 'countdown' && e.rev) { rpm = 900 + e.rev * 5200 + Math.sin(t * 30) * 80; thr = e.rev; }
    if (session.paused) thr = 0;
    const boost = car ? car.boost > 0 : e.boost;
    const f0 = (rpm / 60) * 3;
    const k = 0.03;
    v.o1.frequency.setTargetAtTime(f0, t, k);
    v.o2.frequency.setTargetAtTime(f0 * 0.5, t, k);
    v.o3.frequency.setTargetAtTime(f0 * 2.01, t, k);
    v.filter.frequency.setTargetAtTime(260 + thr * 1500 + rpm * 0.28 + (boost ? 900 : 0), t, 0.05);
    v.nf.frequency.setTargetAtTime(f0 * 1.5 + 80, t, 0.05);
    v.ng.gain.setTargetAtTime(0.05 + thr * 0.16, t, 0.05);
    const base = v.positional ? (menu ? 0.42 : 0.5) : 0.24;
    v.out.gain.setTargetAtTime(base * (0.42 + thr * 0.45 + (boost ? 0.15 : 0)), t, 0.04);
    if (v.pan) {
      const p = e.model.group.position;
      v.pan.positionX.setTargetAtTime(p.x, t, 0.03); v.pan.positionY.setTargetAtTime(p.y, t, 0.03); v.pan.positionZ.setTargetAtTime(p.z, t, 0.03);
    }
    if (!v.positional && car) {
      let slip = 0;
      for (const w of car.wheels) if (w.contact) slip = Math.max(slip, w.slip / 9, w.slipLong / 6, !w.front && car.rearGrip < 0.8 && car.speed > 8 ? 0.7 : 0);
      const road = car.surface <= 1;
      v.sqg.gain.setTargetAtTime(road && car.grounded ? clamp(slip - 0.25, 0, 1) * 0.22 : 0, t, 0.04);
      v.sqf.frequency.setTargetAtTime(1700 + clamp(car.speed * 12, 0, 900), t, 0.1);
      v.wg.gain.setTargetAtTime(clamp(speed / 75, 0, 1.2) ** 2 * 0.16, t, 0.1);
      v.wf.frequency.setTargetAtTime(400 + speed * 14, t, 0.1);
      v.rg.gain.setTargetAtTime(car.grounded && !road ? clamp(car.speed / 30, 0, 1) * 0.3 : 0, t, 0.05);
      if (car.impact > 1800 && (!this._lastHit || t - this._lastHit > 0.15)) { this._lastHit = t; this.hit(clamp(car.impact / 12000, 0.15, 1)); }
      if (car.landing > 5 && (!this._lastLand || t - this._lastLand > 0.3)) { this._lastLand = t; this.thump(clamp(car.landing / 14, 0.2, 1)); }
    }
  }

  // ---- one-shots ------------------------------------------------------------------
  _env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  tone(freq, dur, { type = 'sine', vol = 0.3, when = 0, glide = null, bus = null } = {}) {
    if (!this.ready) return;
    const c = this.ctx;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
    const g = c.createGain();
    this._env(g, t, 0.008, vol, dur);
    o.connect(g).connect(bus || this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noiseBurst(dur, { freq = 1000, q = 1, vol = 0.3, type = 'bandpass', sweep = null, when = 0 } = {}) {
    if (!this.ready) return;
    const c = this.ctx;
    const t = c.currentTime + when;
    const s = this._noiseSrc();
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    const g = c.createGain();
    this._env(g, t, 0.01, vol, dur);
    s.connect(f).connect(g).connect(this.sfx);
    s.start(t);
    s.stop(t + dur + 0.05);
  }

  beep(n) {
    if (n > 0) this.tone(520, 0.2, { type: 'triangle', vol: 0.32 });
    else { this.tone(1040, 0.55, { type: 'triangle', vol: 0.35 }); this.tone(1560, 0.4, { type: 'sine', vol: 0.12 }); }
  }

  hit(k) {
    this.noiseBurst(0.18 + k * 0.2, { freq: 900, q: 0.7, vol: 0.25 + k * 0.35, type: 'lowpass', sweep: 180 });
    this.tone(90, 0.18, { type: 'sine', vol: 0.3 * k, glide: 45 });
  }

  thump(k) {
    this.tone(70, 0.22, { type: 'sine', vol: 0.35 * k, glide: 38 });
    this.noiseBurst(0.12, { freq: 400, vol: 0.12 * k, type: 'lowpass' });
  }

  play(name) {
    if (!this.ready) return;
    switch (name) {
      case 'checkpoint':
        this.tone(NOTE(79), 0.16, { type: 'triangle', vol: 0.22 });
        this.tone(NOTE(86), 0.3, { type: 'triangle', vol: 0.2, when: 0.08 });
        break;
      case 'lap':
        [76, 81, 88].forEach((n, i) => this.tone(NOTE(n), 0.3, { type: 'triangle', vol: 0.22, when: i * 0.09 }));
        break;
      case 'finish':
        [72, 76, 79, 84, 88].forEach((n, i) => this.tone(NOTE(n), 0.5, { type: 'triangle', vol: 0.22, when: i * 0.1 }));
        this.tone(NOTE(60), 1.1, { type: 'sawtooth', vol: 0.06, when: 0.4 });
        break;
      case 'boost':
        this.noiseBurst(0.7, { freq: 300, q: 1.5, vol: 0.3, sweep: 3200 });
        this.tone(180, 0.6, { type: 'sawtooth', vol: 0.06, glide: 520 });
        break;
      case 'slam':
        this.noiseBurst(0.9, { freq: 200, q: 0.8, vol: 0.32, sweep: 4200 });
        this.tone(55, 0.7, { type: 'sine', vol: 0.45, glide: 30 });
        this.noiseBurst(0.25, { freq: 3000, q: 0.5, vol: 0.18, type: 'highpass', when: 0.02 });
        break;
      case 'respawn':
        this.noiseBurst(0.35, { freq: 2400, q: 2, vol: 0.18, sweep: 500 });
        this.tone(880, 0.25, { type: 'sine', vol: 0.12, glide: 440 });
        break;
      case 'click': this.tone(1800, 0.04, { type: 'square', vol: 0.05 }); break;
      case 'hover': this.tone(2400, 0.025, { type: 'sine', vol: 0.03 }); break;
      case 'select': this.tone(NOTE(84), 0.09, { type: 'triangle', vol: 0.12 }); this.tone(NOTE(91), 0.12, { type: 'triangle', vol: 0.1, when: 0.05 }); break;
      case 'back': this.tone(NOTE(79), 0.08, { type: 'triangle', vol: 0.1 }); this.tone(NOTE(72), 0.1, { type: 'triangle', vol: 0.08, when: 0.05 }); break;
      case 'medal':
        [84, 88, 91, 96].forEach((n, i) => this.tone(NOTE(n), 0.4, { type: 'sine', vol: 0.16, when: 0.2 + i * 0.12 }));
        break;
      case 'join': this.tone(NOTE(76), 0.12, { type: 'triangle', vol: 0.14 }); this.tone(NOTE(83), 0.18, { type: 'triangle', vol: 0.12, when: 0.07 }); break;
      case 'leave': this.tone(NOTE(76), 0.12, { type: 'triangle', vol: 0.12 }); this.tone(NOTE(69), 0.18, { type: 'triangle', vol: 0.1, when: 0.07 }); break;
      case 'chat': this.tone(NOTE(88), 0.06, { type: 'sine', vol: 0.1 }); break;
      default: break;
    }
  }

  // ---- music ----------------------------------------------------------------------
  // Every menu screen (title, tracks, garage, lobby) shares the menu song, which
  // carries on where it left off; races have no music.
  setMusic(name) {
    if (!this.ready) { this.pendingMusic = name; return; }
    const want = name === 'lobby' ? 'menu' : name;
    if (this.musicTrack === want) return;
    this.musicTrack = want;
    this._stopSeq();
    if (want === 'menu' && !this.songFailed) { this._playSong(); return; }
    this._pauseSong();
    if (want) this._startSeq(want);
  }

  _songEl() {
    if (this.song) return this.song;
    const el = new Audio();
    el.src = MENU_SONG;
    el.loop = true;
    el.preload = 'auto';
    this.songGain = this.ctx.createGain();
    this.songGain.gain.value = 0;
    this.ctx.createMediaElementSource(el).connect(this.songGain).connect(this.music);
    el.addEventListener('error', () => {
      // no file (offline copy, blocked download): fall back to the synth tune
      this.songFailed = true;
      if (this.musicTrack === 'menu') { this.musicTrack = null; this.setMusic('menu'); }
    });
    this.song = el;
    return el;
  }

  _playSong() {
    const el = this._songEl();
    clearTimeout(this._songPause);
    const t = this.ctx.currentTime;
    this.songGain.gain.cancelScheduledValues(t);
    this.songGain.gain.setTargetAtTime(SONG_GAIN, t, 0.6);
    const p = el.play();
    if (p?.catch) p.catch(() => { /* not allowed yet - unlock() retries */ });
  }

  _pauseSong() {
    if (!this.song) return;
    const t = this.ctx.currentTime;
    this.songGain.gain.cancelScheduledValues(t);
    this.songGain.gain.setTargetAtTime(0, t, 0.25);
    clearTimeout(this._songPause);
    this._songPause = setTimeout(() => this.song.pause(), 1400);
  }

  // ---- pre-race intro --------------------------------------------------------------
  // Picks the next intro song - at random, never the one from last time - and
  // starts loading it (no audio context is needed to load), so it can start the
  // moment the intro does. Returns it; `introSong` has it too.
  prepIntro() {
    const n = INTRO_SONGS.length, last = this.introIdx;
    let i = Math.floor(Math.random() * (n > 1 && last != null ? n - 1 : n));
    if (n > 1 && last != null && i >= last) i++;
    this.introIdx = i;
    if (!this.introEl) { this.introEl = new Audio(); this.introEl.preload = 'auto'; }
    const url = INTRO_SONGS[i].url;
    if (!this.introEl.src.endsWith(url)) this.introEl.src = url;
    return INTRO_SONGS[i];
  }

  get introSong() { return this.introIdx != null ? INTRO_SONGS[this.introIdx] : null; }

  // Plays the intro song picked by prepIntro from `at` seconds in. False if
  // there's no sound yet.
  playIntro(at = 0) {
    if (!this.ready) return false;
    if (!this.introSong) this.prepIntro();
    const el = this.introEl;
    if (!this.introGain) {
      this.introGain = this.ctx.createGain();
      this.ctx.createMediaElementSource(el).connect(this.introGain).connect(this.music);
    }
    clearTimeout(this._introStop);
    this.introCue = at;
    const seek = () => { if (Math.abs(el.currentTime - at) > 0.25) el.currentTime = at; };
    if (el.readyState >= 1) seek(); else el.addEventListener('loadedmetadata', seek, { once: true });
    const t = this.ctx.currentTime;
    this.introGain.gain.cancelScheduledValues(t);
    this.introGain.gain.setValueAtTime(0.0001, t);
    this.introGain.gain.exponentialRampToValueAtTime(SONG_GAIN * 1.15, t + 0.4);
    el.play().catch(() => {});
    return true;
  }

  // seconds of the intro song played since its cue, or null until it's playing
  introTime() {
    const el = this.introEl;
    if (!el || el.paused || el.seeking || el.readyState < 3 || this.introCue == null) return null;
    return el.currentTime - this.introCue;
  }

  // fade the intro song out over `secs`
  stopIntro(secs = 1.2) {
    if (!this.introEl) return;
    if (!this.introGain) { this.introEl.pause(); return; } // loaded, never played
    const t = this.ctx.currentTime;
    const g = this.introGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.0001, g.value), t);
    g.exponentialRampToValueAtTime(0.0001, t + secs);
    const el = this.introEl;
    clearTimeout(this._introStop);
    this._introStop = setTimeout(() => el.pause(), secs * 1000 + 100);
  }

  _stopSeq() {
    if (this._seq) { clearInterval(this._seq); this._seq = null; }
    if (this._musicOut) { const o = this._musicOut; o.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4); setTimeout(() => o.disconnect(), 2000); this._musicOut = null; }
  }

  // A small step sequencer: pad chords, a plucked arpeggio, bass and drums.
  _startSeq(name) {
    const c = this.ctx;
    const out = c.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(1, c.currentTime, 1.2);
    out.connect(this.music);
    this._musicOut = out;
    const song = SONGS[name];
    const spb = 60 / song.bpm / 4; // sixteenth
    let step = 0;
    let next = c.currentTime + 0.1;
    const delay = c.createDelay(1);
    delay.delayTime.value = spb * 3;
    const fb = c.createGain(); fb.gain.value = 0.28;
    const dlp = c.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2400;
    delay.connect(fb).connect(dlp).connect(delay);
    delay.connect(out);
    const sched = () => {
      while (next < c.currentTime + 0.2) {
        this._musicStep(song, step, next, spb, out, delay);
        step++;
        next += spb;
      }
    };
    this._seq = setInterval(sched, 25);
    sched();
  }

  _musicStep(song, step, t, spb, out, delay) {
    const c = this.ctx;
    const bar = Math.floor(step / 16) % song.chords.length;
    const s = step % 16;
    const chord = song.chords[bar];
    const voice = (freq, dur, type, vol, dest = out, attack = 0.01, cutoff = 2400) => {
      const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(f).connect(g).connect(dest);
      o.start(t); o.stop(t + dur + 0.05);
    };
    if (s === 0) for (const n of chord) { voice(NOTE(n), spb * 16, 'sawtooth', 0.018, out, 0.4, 900); voice(NOTE(n) * 1.004, spb * 16, 'sawtooth', 0.014, out, 0.5, 700); }
    // arpeggio
    if (song.arp && song.arp[s] != null) {
      const n = chord[song.arp[s] % chord.length] + 12 * (1 + Math.floor(song.arp[s] / chord.length));
      voice(NOTE(n), spb * 1.6, 'triangle', 0.045, out, 0.005, 3000);
      voice(NOTE(n), spb * 1.6, 'triangle', 0.02, delay, 0.005, 3000);
    }
    // bass
    if (song.bass && song.bass[s]) voice(NOTE(chord[0] - 12), spb * song.bass[s], 'square', 0.035, out, 0.005, 420);
    // drums
    if (song.kick && song.kick[s]) {
      const o = c.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
      const g = c.createGain(); g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(g).connect(out); o.start(t); o.stop(t + 0.25);
    }
    if (song.hat && song.hat[s]) {
      const n = this._noiseSrc(); const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
      const g = c.createGain(); g.gain.setValueAtTime(0.03 * song.hat[s], t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      n.connect(f).connect(g).connect(out); n.start(t); n.stop(t + 0.07);
    }
    if (song.snare && song.snare[s]) {
      const n = this._noiseSrc(); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.7;
      const g = c.createGain(); g.gain.setValueAtTime(0.07, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      n.connect(f).connect(g).connect(out); n.start(t); n.stop(t + 0.2);
    }
  }
}

const x = 1, h = 0.5;
const SONGS = {
  menu: {
    bpm: 96,
    chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],
    arp: [0, null, 2, null, 1, null, 3, null, 2, null, 4, null, 3, null, 1, null],
    bass: [2, 0, 0, 0, 0, 0, 1, 0, 2, 0, 0, 0, 0, 0, 1, 0],
    kick: [x, 0, 0, 0, 0, 0, 0, 0, x, 0, 0, 0, 0, 0, 0, 0],
    hat: [0, 0, h, 0, 0, 0, h, 0, 0, 0, h, 0, 0, 0, h, x],
    snare: [0, 0, 0, 0, x, 0, 0, 0, 0, 0, 0, 0, x, 0, 0, 0],
  },
  lobby: {
    bpm: 108,
    chords: [[50, 57, 62], [55, 59, 62], [47, 55, 59], [52, 55, 60]],
    arp: [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1, 0, null],
    bass: [2, 0, 1, 0, 2, 0, 1, 0, 2, 0, 1, 0, 2, 0, 1, 1],
    kick: [x, 0, 0, 0, x, 0, 0, 0, x, 0, 0, 0, x, 0, 0, 0],
    hat: [0, 0, x, 0, 0, 0, x, 0, 0, 0, x, 0, 0, 0, x, 0],
    snare: [0, 0, 0, 0, x, 0, 0, 0, 0, 0, 0, 0, x, 0, 0, 0],
  },
};

function distCurve(k) {
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x2 = (i * 2) / n - 1; curve[i] = ((1 + k) * x2) / (1 + k * Math.abs(x2)); }
  return curve;
}
