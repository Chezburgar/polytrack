// Pause menu (in single player the race is frozen; online it keeps running).
import { h } from '../dom.js';
import { button } from '../ui.js';
import { logo } from './title.js';

export class PauseOverlay {
  constructor(ui, data = {}) {
    this.ui = ui;
    const app = ui.app;
    const s = app.session;
    const online = s?.mode === 'online';
    this.el = h('div.screen.pause-screen',
      h('div.panel.pause-card',
        logo('small'),
        h('h2', online ? 'Menu' : 'Paused'),
        online ? h('p.note', 'The race keeps running while this menu is open.') : null,
        button('Resume', () => { app.audio.play('select'); if (online) ui.closeOverlay(); else app.resume(); }, 'primary big wide'),
        s?.mode !== 'online' ? button('Restart', () => { app.audio.play('select'); app.restartRace(); }, 'big wide') : null,
        button('Respawn at checkpoint', () => { ui.closeOverlay(); if (!online) app.resume(); s?.respawn(s.player); }, 'wide'),
        online && app.net?.isHost ? button('End race for everyone', () => { app.net.endRace(); ui.closeOverlay(); }, 'wide') : null,
        button('Settings', () => { app.audio.play('select'); ui.overlay('settings'); }, 'wide'),
        button(online ? 'Leave room' : 'Quit to menu', () => app.quitRace(), 'wide danger'),
      ));
  }
}
