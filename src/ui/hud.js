// In-race HUD: timer, splits, speedometer, minimap, standings, countdown.
import { h } from './dom.js';
import { drawTrack, mapTransform } from './trackmap.js';
import { formatTime, formatDelta, clamp } from '../util/math.js';

export class HUD {
  constructor(app) {
    this.app = app;
    this.el = h('div.hud');
    this.timer = h('div.hud-timer', '0:00.000');
    this.sub = h('div.hud-sub');
    this.splitEl = h('div.hud-split');
    this.top = h('div.hud-top', this.timer, this.sub, this.splitEl);
    this.posEl = h('div.hud-pos');
    this.lapEl = h('div.hud-lap');
    this.cpEl = h('div.hud-cp');
    this.left = h('div.hud-left', this.posEl, this.lapEl, this.cpEl);
    this.map = h('canvas.hud-map', { width: 220, height: 220 });
    this.mapBg = document.createElement('canvas');
    this.mapBg.width = this.mapBg.height = 220;
    this.speed = h('div.hud-speed-num', '0');
    this.unit = h('div.hud-speed-unit', 'KM/H');
    this.gear = h('div.hud-gear', '1');
    this.rpmFill = h('i');
    this.boostFill = h('i');
    this.speedo = h('div.hud-speedo',
      h('div.hud-speed-row', this.speed, h('div.hud-speed-side', this.unit, this.gear)),
      h('div.hud-rpm', this.rpmFill),
      h('div.hud-boost', this.boostFill));
    this.center = h('div.hud-center');
    this.count = h('div.hud-count');
    this.msg = h('div.hud-msg');
    this.center.append(this.count, this.msg);
    this.standings = h('div.hud-standings');
    this.hint = h('div.hud-hint');
    this.fps = h('div.hud-fps');
    this.el.append(this.top, this.left, this.map, this.speedo, this.center, this.standings, this.hint, this.fps);
    this.cache = {};
    this.splitUntil = 0;
    this.countUntil = 0;
    this.t = 0;
  }

  attach(session) {
    this.session = session;
    const T = drawTrack(this.mapBg.getContext('2d'), session.track, 220, 220, { pad: 14 });
    this.mapT = T;
    const mode = session.mode;
    const kb = this.app.input.lastDevice === 'gamepad'
      ? 'B respawn · Back restart · X camera · Start pause'
      : mode === 'timetrial' ? 'R respawn · Backspace restart · C camera · Space drift · Esc pause' : 'R respawn · C camera · Space drift · Esc pause';
    this.hint.textContent = kb;
    this.hint.classList.remove('fade');
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => this.hint.classList.add('fade'), 7000);
    this.standings.style.display = session.entries.filter((e) => e.kind !== 'ghost').length > 1 ? '' : 'none';
    const rec = this.app.records[session.opts.def.id];
    this.pb = rec?.best ?? null;
    this.sub.textContent = this.pb != null && session.mode === 'timetrial' ? `PB ${formatTime(this.pb)}` : session.opts.def.name;
    this.splitEl.className = 'hud-split';
    this.count.className = 'hud-count';
    this.cache = {};
  }

  set(key, el, value, prop = 'textContent') {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el[prop] = value;
  }

  countdown(n) {
    this.count.textContent = n > 0 ? String(n) : 'GO!';
    this.count.className = 'hud-count show' + (n === 0 ? ' go' : '');
    void this.count.offsetWidth;
    this.count.classList.add('pop');
    this.countUntil = this.t + (n === 0 ? 0.9 : 0.95);
  }

  split(time, delta, label) {
    const d = delta == null ? '' : formatDelta(delta * 1000);
    this.splitEl.innerHTML = '';
    this.splitEl.append(h('span.l', label), h('span.t', formatTime(time * 1000)), d ? h('span.d' + (delta <= 0 ? '.good' : '.bad'), d) : '');
    this.splitEl.className = 'hud-split show';
    this.splitUntil = this.t + 2.6;
  }

  update(dt) {
    this.t += dt;
    const s = this.session;
    if (!s) return;
    const d = s.hud();
    const units = this.app.settings.units;
    const sp = units === 'mph' ? d.speed * 2.23694 : d.speed * 3.6;
    this.set('speed', this.speed, String(Math.round(sp)));
    this.set('unit', this.unit, units === 'mph' ? 'MPH' : 'KM/H');
    this.set('gear', this.gear, d.gear < 0 ? 'R' : d.speed < 0.5 && d.state === 'countdown' ? 'N' : String(d.gear));
    const rpm = clamp((d.rpm - 900) / 6900, 0, 1);
    this.rpmFill.style.transform = `scaleX(${rpm.toFixed(3)})`;
    this.rpmFill.classList.toggle('red', rpm > 0.9);
    this.boostFill.style.transform = `scaleX(${clamp(d.boost / 1.35, 0, 1).toFixed(3)})`;
    this.set('timer', this.timer, d.state === 'countdown' ? '0:00.000' : formatTime((d.finished ? d.finishTime : d.time) * 1000));
    this.timer.classList.toggle('done', !!d.finished);
    if (d.laps) this.set('lap', this.lapEl, `LAP ${d.lap}/${d.laps}`); else this.set('lap', this.lapEl, '');
    this.set('cp', this.cpEl, `CP ${Math.min(d.cp, d.cpTotal)}/${d.cpTotal}`);
    if (d.racers > 1) this.set('pos', this.posEl, `${d.place}<small>/${d.racers}</small>`, 'innerHTML'); else this.set('pos', this.posEl, '');
    if (this.t > this.splitUntil && this.splitEl.classList.contains('show')) this.splitEl.classList.remove('show');
    if (this.t > this.countUntil && this.count.classList.contains('show')) this.count.className = 'hud-count';
    // messages
    let m = '';
    let cls = '';
    if (d.wrongWay) { m = 'WRONG WAY'; cls = 'warn'; }
    else if (d.messages.length) { const last = d.messages[d.messages.length - 1]; m = last.text; cls = last.kind; }
    this.set('msg', this.msg, m);
    this.set('msgc', this.msg, 'hud-msg ' + cls + (m ? ' show' : ''), 'className');
    this.drawMap(s);
    if (s.standings && this.standings.style.display !== 'none' && (this._stT = (this._stT || 0) + dt) > 0.25) {
      this._stT = 0;
      this.drawStandings(s);
    }
    if (this.app.settings.showFps) this.set('fps', this.fps, `${Math.round(this.app.fps)} FPS`); else this.set('fps', this.fps, '');
  }

  drawMap(s) {
    const ctx = this.map.getContext('2d');
    ctx.clearRect(0, 0, 220, 220);
    ctx.drawImage(this.mapBg, 0, 0);
    const T = this.mapT;
    const list = s.entries.slice().sort((a, b) => (a === s.focus) - (b === s.focus));
    for (const e of list) {
      if (!e.model.group.visible) continue;
      const p = e.model.group.position;
      const x = T.x(p.x), y = T.y(p.z);
      const me = e === s.focus;
      ctx.beginPath();
      ctx.arc(x, y, me ? 6 : 4.2, 0, Math.PI * 2);
      ctx.fillStyle = e.kind === 'ghost' ? 'rgba(255,255,255,0.45)' : e.custom?.paint || '#fff';
      ctx.fill();
      ctx.lineWidth = me ? 2.5 : 1.5;
      ctx.strokeStyle = me ? '#ffffff' : 'rgba(0,0,0,0.7)';
      ctx.stroke();
    }
  }

  drawStandings(s) {
    const leader = s.standings[0];
    const rows = s.standings.slice(0, 8).map((e) => {
      let gap = '';
      if (e.race.finished || e.finishTime != null) gap = formatTime((e.finishTime ?? e.race.finishTime) * 1000);
      else if (e !== leader) {
        const dc = (leader.completion - e.completion) * s.track.length * Math.max(1, s.laps);
        gap = dc > 0 ? `-${Math.round(dc)} m` : '';
      }
      return h('div.st-row' + (e === s.focus ? '.me' : ''),
        h('span.st-pos', String(e.place)),
        h('span.st-chip', { style: { background: e.custom?.paint || '#888' } }),
        h('span.st-name', e.name || '?'),
        h('span.st-gap', gap));
    });
    this.standings.replaceChildren(...rows);
  }
}
