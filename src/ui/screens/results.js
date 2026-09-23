// End-of-race screen: time, medal, personal best, standings, next steps.
import { h, icon, clear } from '../dom.js';
import { button } from '../ui.js';
import { TRACKS } from '../../track/tracks.js';
import { MEDALS } from '../../track/medals.js';
import { formatTime, formatDelta } from '../../util/math.js';
import { medalIcon, MEDAL_NAMES } from './play.js';

export class ResultsScreen {
  constructor(ui, data = {}) {
    this.ui = ui;
    const app = (this.app = ui.app);
    const s = (this.session = app.session);
    this.data = data;
    const def = s?.opts.def;
    const idx = TRACKS.findIndex((t) => t.id === def?.id);
    const next = TRACKS[(idx + 1) % TRACKS.length];
    const md = MEDALS[def?.id];
    const online = s?.mode === 'online';
    this.table = h('div.standings');
    this.actions = h('div.res-actions');
    const medal = data.medal;
    if (medal) setTimeout(() => app.audio.play('medal'), 300);
    const rec = app.records[def?.id];
    const prevBest = data.pb && data.delta != null ? null : null;
    void prevBest;
    this.el = h('div.screen.results-screen',
      h('div.panel.res-card',
        h('div.res-track', def?.name || ''),
        h('div.res-time' + (data.pb ? '.pb' : ''), formatTime(data.time)),
        data.pb ? h('div.res-badge', 'NEW PERSONAL BEST') : rec?.best != null ? h('div.res-sub', `Best ${formatTime(rec.best)}  (${formatDelta(data.time - rec.best)})`) : null,
        medal ? h('div.res-medal', medalIcon(medal, true), h('span', `${MEDAL_NAMES[medal]} medal`)) : md ? h('div.res-sub', 'No medal this time') : null,
        md && !online ? h('div.res-ladder', ...['author', 'gold', 'silver', 'bronze'].map((m) =>
          h('div.tdm' + (data.time <= md[m] ? '.got' : ''), medalIcon(m), h('span', MEDAL_NAMES[m]), h('b', formatTime(md[m]))))) : null,
        this.table,
        this.actions,
      ));
    this.render();
    if (online) this.off = app.net?.on(() => this.render());
    this.next = next;
  }

  render() {
    const app = this.app, s = this.session;
    if (!s) return;
    const online = s.mode === 'online';
    clear(this.table);
    if (s.entries.filter((e) => e.kind !== 'ghost').length > 1) {
      const list = (s.standings || []).slice();
      list.forEach((e, i) => {
        const t = e.finishTime ?? e.race.finishTime;
        this.table.append(h('div.st-row' + (e === s.player ? '.me' : ''),
          h('span.st-pos', String(i + 1)),
          h('span.st-chip', { style: { background: e.custom?.paint || '#888' } }),
          h('span.st-name', e.name),
          h('span.st-gap', t != null ? formatTime(t * 1000) : online && app.net?.state === 'results' ? 'DNF' : 'racing…')));
      });
    }
    clear(this.actions);
    if (online) {
      const net = app.net;
      if (!net) return;
      if (net.isHost) {
        if (net.state === 'racing') this.actions.append(h('div.wait-note', 'Waiting for the others to finish…'), button('End race now', () => net.endRace(), 'wide'));
        this.actions.append(button([icon('users'), h('span', 'Back to lobby')], () => net.backToLobby(), 'primary big wide'));
      } else {
        this.actions.append(h('div.wait-note', net.state === 'results' ? 'Race over - the host will take everyone back to the lobby.' : 'Waiting for the others to finish…'));
      }
      this.actions.append(button('Leave room', () => app.quitRace(), 'wide ghost'));
      return;
    }
    this.actions.append(
      button([icon('flag'), h('span', 'Retry')], () => { app.audio.play('select'); app.restartRace(); }, 'primary big'),
      button(['Next track'], () => { app.audio.play('select'); app.startRace({ ...app.lastRace, def: this.next, laps: this.next.laps }); }, 'big'),
      button('Tracks', () => { app.audio.play('back'); app.toMenu('play'); }, ''),
      button('Menu', () => { app.audio.play('back'); app.toMenu('title'); }, ''),
    );
  }

  update() {
    if (this.session?.mode === 'online' && (this._t = (this._t || 0) + 1) % 20 === 0) this.render();
  }

  destroy() { this.off?.(); }
}
