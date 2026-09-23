// Screen manager: one full screen at a time, an overlay layer (pause,
// settings), toasts and the HUD.
import { h, clear } from './dom.js';
import { HUD } from './hud.js';
import { TitleScreen } from './screens/title.js';
import { PlayScreen } from './screens/play.js';
import { GarageScreen } from './screens/garage.js';
import { OnlineScreen, LobbyScreen } from './screens/online.js';
import { SettingsScreen } from './screens/settings.js';
import { ResultsScreen } from './screens/results.js';
import { PauseOverlay } from './screens/pause.js';
import { TouchControls } from './touch.js';

const SCREENS = {
  title: TitleScreen, play: PlayScreen, garage: GarageScreen, online: OnlineScreen, lobby: LobbyScreen,
  settings: SettingsScreen, results: ResultsScreen,
};

export class UI {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('ui');
    this.layer = h('div.layer');
    this.hudLayer = h('div.layer.hud-layer');
    this.overlayLayer = h('div.layer.overlay-layer');
    this.toasts = h('div.toasts');
    this.root.append(this.hudLayer, this.layer, this.overlayLayer, this.toasts);
    this.hud = new HUD(app);
    this.touch = new TouchControls(app);
    this.root.append(this.touch.el);
    this.current = null;
    this.screen = null;
    this.overlayScreen = null;
    this.garage = null;
    // menu navigation by keyboard / pad: arrows move focus between buttons
    document.addEventListener('keydown', (e) => this._nav(e));
    app.input.on('menuUp', () => this._move(-1));
    app.input.on('menuDown', () => this._move(1));
    app.input.on('menuSelect', () => { if (document.activeElement?.click && this.app.mode !== 'race') document.activeElement.click(); });
  }

  boot(done) {
    const boot = document.getElementById('boot');
    const bar = boot?.querySelector('.boot-bar i');
    let k = 0;
    const tick = () => {
      k = Math.min(1, k + 0.18);
      if (bar) bar.style.transform = `scaleX(${k})`;
      if (k < 1) requestAnimationFrame(tick);
      else {
        try { done(); } catch (e) { console.error(e); boot.querySelector('.boot-msg').textContent = 'Failed to start: ' + e.message; return; }
        boot?.classList.add('gone');
        setTimeout(() => boot?.remove(), 700);
      }
    };
    requestAnimationFrame(tick);
  }

  show(name, data) {
    this.closeOverlay();
    if (this.screen?.destroy) this.screen.destroy();
    clear(this.layer);
    this.screen = null;
    this.current = name;
    const hud = name === 'hud';
    this.hudLayer.classList.toggle('on', hud || name === 'results');
    this.touch.setActive(hud);
    if (hud) {
      clear(this.hudLayer);
      this.hudLayer.append(this.hud.el);
      this.hud.attach(this.app.session);
      if (this.app.session?.mode === 'online') this.app.net?.attachChat?.(this.hudLayer);
      return;
    }
    const S = SCREENS[name];
    if (!S) return;
    this.screen = new S(this, data);
    this.layer.append(this.screen.el);
    requestAnimationFrame(() => this.screen?.el.classList.add('in'));
    const first = this.screen.el.querySelector('[autofocus], .btn.primary, .btn');
    if (first && !matchMedia('(pointer: coarse)').matches) first.focus({ preventScroll: true });
  }

  overlay(name, data) {
    this.closeOverlay();
    const S = name === 'pause' ? PauseOverlay : SCREENS[name];
    this.overlayScreen = new S(this, { ...data, overlay: true });
    this.overlayLayer.append(this.overlayScreen.el);
    this.overlayLayer.classList.add('on');
    requestAnimationFrame(() => this.overlayScreen?.el.classList.add('in'));
    const first = this.overlayScreen.el.querySelector('.btn.primary, .btn');
    first?.focus({ preventScroll: true });
  }

  closeOverlay() {
    if (this.overlayScreen?.destroy) this.overlayScreen.destroy();
    this.overlayScreen = null;
    clear(this.overlayLayer);
    this.overlayLayer.classList.remove('on');
  }

  togglePause() {
    if (this.overlayScreen) this.closeOverlay(); else this.overlay('pause', { online: true });
  }

  toast(text, kind = '') {
    const t = h('div.toast' + (kind ? '.' + kind : ''), text);
    this.toasts.append(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 400); }, 2600);
  }

  update(dt) {
    if (this.current === 'hud' || this.current === 'results') this.hud.update(dt);
    this.screen?.update?.(dt);
    this.overlayScreen?.update?.(dt);
    this.touch.update();
  }

  _focusables() {
    const scope = this.overlayScreen?.el || this.screen?.el;
    if (!scope) return [];
    return [...scope.querySelectorAll('button:not([disabled]), [tabindex="0"], input, select')].filter((b) => b.offsetParent !== null);
  }

  _move(dir) {
    const list = this._focusables();
    if (!list.length) return;
    const i = list.indexOf(document.activeElement);
    const n = list[(i + dir + list.length) % list.length];
    n.focus();
    this.app.audio.play('hover');
  }

  _nav(e) {
    if (this.app.mode === 'race' && !this.overlayScreen && this.current !== 'results') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.code === 'ArrowDown') { e.preventDefault(); this._move(1); }
    else if (e.code === 'ArrowUp') { e.preventDefault(); this._move(-1); }
    else if (e.code === 'Escape' && this.app.mode !== 'race') { this.screen?.back?.(); }
  }
}

// shared bits for screens
export function button(label, onClick, cls = '', extra = {}) {
  return h('button.btn' + (cls ? '.' + cls.split(' ').join('.') : ''), { type: 'button', ...extra, onclick: onClick }, label);
}
