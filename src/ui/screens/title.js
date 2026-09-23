// Title screen over the live menu backdrop.
import { h, icon } from '../dom.js';
import { button } from '../ui.js';
import { VERSION } from '../../app.js';
import { TRACKS } from '../../track/tracks.js';
import { medalFor } from '../../app.js';

export function logo(size = '') {
  return h('div.logo' + (size ? '.' + size : ''),
    h('span.logo-mark', { html: '<svg viewBox="0 0 64 64"><polygon points="32,3 60,19 60,45 32,61 4,45 4,19" fill="#12213a"/><polygon points="32,3 60,19 32,32" fill="#2f86eb"/><polygon points="60,19 60,45 32,32" fill="#1f5fb8"/><polygon points="60,45 32,61 32,32" fill="#39c6f0"/><polygon points="32,61 4,45 32,32" fill="#ffd23c"/><polygon points="4,45 4,19 32,32" fill="#f39c34"/><polygon points="4,19 32,3 32,32" fill="#e8433a"/><polygon points="32,18 44,25 44,39 32,46 20,39 20,25" fill="#0d1321"/><polygon points="28,25 40,32 28,39" fill="#fff"/></svg>' }),
    h('span.logo-word', h('b', 'POLY'), h('i', 'TRACK')));
}

export class TitleScreen {
  constructor(ui) {
    this.ui = ui;
    const app = ui.app;
    const golds = TRACKS.filter((t) => { const r = app.records[t.id]; const m = r?.best != null ? medalFor(t.id, r.best) : null; return m === 'gold' || m === 'author'; }).length;
    const played = TRACKS.filter((t) => app.records[t.id]?.best != null).length;
    const go = (name) => () => { app.audio.play('select'); ui.show(name); };
    this.el = h('div.screen.title-screen',
      h('div.title-left',
        logo('big'),
        h('div.tagline', 'Low-poly racing. Twenty tracks. Your car, your way.'),
        h('div.menu-stack',
          button([icon('play'), h('span', 'Play')], go('play'), 'primary big', { autofocus: true }),
          button([icon('users'), h('span', 'Multiplayer')], go('online'), 'big'),
          button([icon('edit'), h('span', 'Track Builder')], () => { app.audio.play('select'); app.openEditor(); }, 'big'),
          button([icon('car'), h('span', 'Garage')], () => { app.audio.play('select'); app.openGarage(); }, 'big'),
          button([icon('gear'), h('span', 'Settings')], go('settings'), 'big'),
        ),
        h('div.title-stats',
          h('div', h('b', `${played}/${TRACKS.length}`), h('span', 'tracks raced')),
          h('div', h('b', `${golds}`), h('span', 'gold medals')),
        ),
      ),
      h('div.title-foot', h('span', `v${VERSION}`), h('span', 'WASD / Arrows to drive · Space to drift · C to change camera'),
        h('div.foot-right',
          this.sound = h('button.sound-hint', { type: 'button', title: 'Browsers keep sound off until you click or press a key', onclick: () => app.audio.unlock() }, icon('sound'), 'Click for sound'),
          h('button.fs-btn', { type: 'button', title: 'Full screen (F11)', onclick: () => toggleFullscreen() }, '⛶ Full screen'))),
    );
    this.app = app;
  }

  update() { this.sound.classList.toggle('gone', this.app.audio.running); }
}

export function toggleFullscreen() {
  const d = document;
  try {
    if (d.fullscreenElement) d.exitFullscreen();
    else d.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  } catch { /* not allowed here - F11 still works */ }
}
