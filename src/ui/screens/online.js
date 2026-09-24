// Multiplayer: create/join a room, then the lobby (roster, chat, track pick).
import { h, icon, clear } from '../dom.js';
import { button } from '../ui.js';
import { NetSession, MAX_PLAYERS } from '../../net/net.js';
import { TRACKS } from '../../track/tracks.js';
import { getTheme } from '../../track/themes.js';
import { trackThumb, trackInfo } from './play.js';
import { QUICK_CHAT } from '../chat.js';
import { library, saveToLibrary } from '../../track/custom.js';

export class OnlineScreen {
  constructor(ui, data = {}) {
    this.ui = ui;
    const app = (this.app = ui.app);
    const params = app.params;
    this.local = params.get('net') === 'local';
    this.name = h('input.name-input', { type: 'text', maxLength: 16, placeholder: 'Your name', value: app.profile.name || '' });
    this.name.addEventListener('input', () => { app.profile.name = this.name.value.slice(0, 16); app.saveProfile(); });
    this.code = h('input.code-input', { type: 'text', maxLength: 5, placeholder: 'CODE', autocomplete: 'off', spellcheck: false, value: data.code || params.get('room') || '' });
    this.code.addEventListener('input', () => { this.code.value = this.code.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    this.code.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.join(); });
    this.status = h('div.net-status');
    this.createBtn = button([icon('users'), h('span', 'Create room')], () => this.create(), 'primary big');
    this.joinBtn = button('Join', () => this.join(), 'big');
    this.el = h('div.screen.online-screen',
      h('div.screen-head', button([icon('back')], () => this.back(), 'icon-btn'), h('h1', 'Multiplayer')),
      h('div.online-body',
        h('div.panel.online-card',
          h('h2', 'Race your friends'),
          h('p', 'Create a room and share its five-letter code. Up to 8 players race together, with AI to fill the grid. Everything connects peer-to-peer - no account needed.'),
          h('label.field', h('span', 'Driver name'), this.name),
          this.createBtn,
          h('div.or', h('span', 'or join a room')),
          h('div.join-row', this.code, this.joinBtn),
          this.status,
          this.local ? h('p.note', 'Local test mode: rooms only connect tabs of this browser.') : null,
        ),
      ),
    );
    if (params.get('room') && !data.auto) setTimeout(() => this.join(), 50);
  }

  back() { this.app.audio.play('back'); this.ui.show('title'); }

  busy(b, msg = '') {
    this.createBtn.disabled = b; this.joinBtn.disabled = b;
    this.status.textContent = msg;
    this.status.className = 'net-status' + (b ? ' busy' : '');
  }

  async create() {
    if (!this.name.value.trim()) { this.name.focus(); this.status.textContent = 'Pick a name first.'; return; }
    this.app.audio.play('select');
    this.busy(true, 'Creating room…');
    const net = new NetSession(this.app);
    try {
      await net.create({ local: this.local });
      this.app.net = net;
      this.ui.show('lobby');
    } catch (e) {
      console.warn(e);
      this.busy(false, e.message);
      this.status.classList.add('err');
    }
  }

  async join() {
    const code = this.code.value.trim().toUpperCase();
    if (code.length !== 5) { this.code.focus(); this.status.textContent = 'Room codes are 5 characters.'; return; }
    if (!this.name.value.trim()) { this.name.focus(); this.status.textContent = 'Pick a name first.'; return; }
    this.app.audio.play('select');
    this.busy(true, `Joining ${code}…`);
    const net = new NetSession(this.app);
    try {
      await net.join(code, { local: this.local });
      this.app.net = net;
      this.ui.show('lobby');
    } catch (e) {
      console.warn(e);
      net.leave();
      this.busy(false, e.message);
      this.status.classList.add('err');
    }
  }
}

export class LobbyScreen {
  constructor(ui) {
    this.ui = ui;
    const app = (this.app = ui.app);
    const net = (this.net = app.net);
    if (!net) { setTimeout(() => ui.show('online'), 0); this.el = h('div'); return; }
    this.roster = h('div.roster');
    this.chatLog = h('div.chat-log');
    this.chatInput = h('input.chat-input', { type: 'text', maxLength: 140, placeholder: 'Say something…' });
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { net.chat(this.chatInput.value); this.chatInput.value = ''; }
    });
    this.side = h('div.lobby-side');
    this.action = h('div.lobby-action');
    const link = `${location.origin}${location.pathname}?room=${net.code}${net.local ? '&net=local' : ''}`;
    this.el = h('div.screen.lobby-screen',
      h('div.screen-head',
        button([icon('back')], () => this.back(), 'icon-btn'),
        h('h1', 'Lobby'),
        h('div.room-code', h('span', 'Room'), h('b', net.code),
          button([icon('copy')], () => this.copy(net.code, 'Code copied'), 'icon-btn small', { title: 'Copy code' }),
          button([icon('link')], () => this.copy(link, 'Invite link copied'), 'icon-btn small', { title: 'Copy invite link' }))),
      h('div.lobby-body',
        h('div.lobby-main',
          h('div.panel', h('h3', 'Drivers ', h('small', `(max ${MAX_PLAYERS})`)), this.roster),
          h('div.panel.chat', h('h3', 'Chat'), this.chatLog,
            h('div.chat-row', this.chatInput, button([icon('send')], () => { net.chat(this.chatInput.value); this.chatInput.value = ''; this.chatInput.focus(); }, 'icon-btn small', { title: 'Send' })),
            h('div.quick-chat', ...QUICK_CHAT.map((q) => h('button', { type: 'button', onclick: () => net.chat(q) }, q))))),
        h('div.lobby-right', this.side, this.action)),
    );
    this.off = net.on((kind) => { if (kind === 'chat') this.renderChat(); else this.render(); });
    net.updateCar();
    this.render();
    this.renderChat();
    app.audio.setMusic('lobby');
  }

  copy(text, msg) {
    const done = () => this.ui.toast(msg);
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => prompt('Copy this:', text));
    else prompt('Copy this:', text);
  }

  back() {
    this.app.audio.play('back');
    if (!confirm('Leave this room?')) return;
    this.app.net?.leave();
    this.app.net = null;
    this.ui.show('online');
  }

  render() {
    const net = this.net;
    const app = this.app;
    clear(this.roster);
    for (const p of net.list()) {
      this.roster.append(h('div.player' + (p.id === net.selfId ? '.me' : ''),
        h('span.pchip', { style: { background: p.car?.paint || '#888', '--acc': p.car?.accent || '#fff' } }),
        h('span.pname', p.name),
        p.host ? h('span.tag.host', icon('crown'), 'Host') : p.ready ? h('span.tag.ready', icon('check'), 'Ready') : h('span.tag.wait', 'Not ready'),
        h('span.ping', p.host ? '' : p.ping ? `${p.ping} ms` : ''),
        net.isHost && !p.host ? button('Kick', () => net.kick(p.id), 'tiny ghost') : null));
    }
    for (let i = net.players.size; i < Math.min(MAX_PLAYERS, net.players.size + (net.settings.bots || 0)); i++) {
      this.roster.append(h('div.player.bot', h('span.pchip.bot', icon('robot')), h('span.pname', 'AI driver'), h('span.tag.wait', net.settings.difficulty)));
    }
    // side: track + settings
    const s = net.settings;
    const def = net.trackDef() || TRACKS[0];
    clear(this.side);
    const thumb = trackThumb(def, 320, 180);
    const trackRow = h('div.lobby-track', thumb, h('div', h('b', def.name), h('span', `${getTheme(def.theme).name} · ${def.laps ? (s.laps || def.laps) + ' laps' : 'Sprint'} · ${(trackInfo(def).track.length / 1000).toFixed(1)} km${def.custom ? ` · custom${def.author ? ' by ' + def.author : ''}` : ''}`)));
    this.side.append(h('div.panel', h('h3', 'Track'), trackRow));
    if (def.custom && !net.isHost) {
      const have = library().some((d) => d.id === def.id);
      trackRow.append(button(have ? 'In your tracks' : 'Save to my tracks', (e) => { saveToLibrary({ ...def, slot: undefined }); e.currentTarget.textContent = 'Saved'; e.currentTarget.disabled = true; this.ui.toast(`Saved "${def.name}" to your tracks`); }, 'small', { disabled: have }));
    }
    if (net.isHost) {
      const mine = library().filter((d) => d.routeOk !== false);
      const sel = h('select.track-select',
        h('optgroup', { label: 'PolyTrack Pro tracks' }, ...TRACKS.map((t, i) => h('option', { value: t.id, selected: t.id === s.trackId }, `${String(i + 1).padStart(2, '0')}  ${t.name}`))),
        mine.length ? h('optgroup', { label: 'My tracks' }, ...mine.map((t) => h('option', { value: 'lib:' + t.slot, selected: t.id === s.trackId }, t.name))) : null);
      sel.addEventListener('change', () => net.setSetting('trackId', sel.value.startsWith('lib:') ? mine.find((t) => 'lib:' + t.slot === sel.value) : sel.value));
      const opts = h('div.opts',
        h('div.opt', h('span', 'Track'), sel),
        def.laps ? this.stepper('Laps', s.laps || def.laps, 1, 9, (v) => net.setSetting('laps', v)) : null,
        this.stepper('AI drivers', s.bots || 0, 0, MAX_PLAYERS - net.players.size, (v) => net.setSetting('bots', v)),
        (s.bots || 0) > 0 ? this.choice('AI skill', ['easy', 'medium', 'hard', 'pro'], s.difficulty, (v) => net.setSetting('difficulty', v)) : null);
      this.side.firstChild.append(opts);
    }
    clear(this.action);
    if (net.state === 'waiting' || net.state === 'racing') {
      this.action.append(h('div.wait-note', 'A race is in progress - you will join the next one.'));
    } else if (net.isHost) {
      const guests = net.list().filter((p) => !p.host);
      const allReady = guests.every((p) => p.ready);
      this.action.append(
        h('div.wait-note', guests.length ? allReady ? 'Everyone is ready.' : `${guests.filter((p) => !p.ready).length} not ready yet` : 'Share the code - or start alone with AI.'),
        button([icon('flag'), h('span', 'Start race')], () => { app.audio.play('select'); net.startRace(); }, 'primary big wide'));
    } else {
      const me = net.me;
      this.action.append(
        h('div.wait-note', 'The host starts the race.'),
        button(me?.ready ? [icon('check'), h('span', 'Ready!')] : 'Ready up', () => { net.setReady(!me?.ready); app.audio.play('click'); }, (me?.ready ? 'on ' : '') + 'primary big wide'));
    }
    this.action.append(button([icon('car'), h('span', 'Garage')], () => app.openGarage(true), 'wide'));
  }

  stepper(label, value, min, max, set) {
    const val = h('b', String(value));
    const upd = (d) => { const v = Math.max(min, Math.min(max, value + d)); if (v !== value) { value = v; val.textContent = v; set(v); } };
    return h('div.opt', h('span', label), h('div.stepper', h('button', { type: 'button', onclick: () => upd(-1) }, '−'), val, h('button', { type: 'button', onclick: () => upd(1) }, '+')));
  }

  choice(label, values, cur, set) {
    return h('div.opt', h('span', label), h('div.choice', ...values.map((v) => h('button' + (v === cur ? '.on' : ''), { type: 'button', onclick: () => set(v) }, v[0].toUpperCase() + v.slice(1)))));
  }

  renderChat() {
    clear(this.chatLog);
    for (const m of this.net.chatLog.slice(-40)) {
      this.chatLog.append(m.sys ? h('div.msg.sys', m.text) : h('div.msg', h('b', { style: { color: m.color || '#9cf' } }, m.name + ':'), ' ', m.text));
    }
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  destroy() { this.off?.(); }
}
