// Settings: graphics, camera, audio, gameplay, controls, data.
import { h, icon, clear } from '../dom.js';
import { button } from '../ui.js';
import { DEFAULT_SETTINGS } from '../../app.js';

export class SettingsScreen {
  constructor(ui, data = {}) {
    this.ui = ui;
    this.app = ui.app;
    this.overlay = !!data.overlay;
    this.body = h('div.settings-body');
    this.el = h('div.screen.settings-screen' + (this.overlay ? '.as-overlay' : ''),
      h('div.screen-head', button([icon('back')], () => this.back(), 'icon-btn'), h('h1', 'Settings')),
      this.body);
    this.render();
  }

  back() {
    this.app.audio.play('back');
    if (this.overlay) this.ui.overlay('pause'); else this.ui.show('title');
  }

  set(k, v) {
    const s = this.app.settings;
    s[k] = v;
    this.app.saveSettings();
    if (k === 'quality') { this.app.setQuality(v); this.render(); return; }
    if (['master', 'music', 'sfx'].includes(k)) this.app.audio.applyVolumes();
    if (k === 'fov' && this.app.session) this.app.session.camera.baseFov = v;
    if (k === 'camera' && this.app.session && this.app.mode === 'race') this.app.session.camera.setMode(v);
    if (k === 'touch') this.app.ui.touch.refresh();
    this.render();
  }

  seg(k, opts) {
    const cur = this.app.settings[k];
    return h('div.choice', ...opts.map(([v, label]) => h('button' + (v === cur ? '.on' : ''), { type: 'button', onclick: () => { this.app.audio.play('click'); this.set(k, v); } }, label)));
  }

  slider(k, min, max, step, fmt = (v) => Math.round(v * 100) + '%') {
    const v = this.app.settings[k];
    const out = h('b', fmt(v));
    const inp = h('input.slider', { type: 'range', min, max, step, value: v });
    inp.addEventListener('input', () => { const x = parseFloat(inp.value); this.app.settings[k] = x; out.textContent = fmt(x); if (['master', 'music', 'sfx'].includes(k)) this.app.audio.applyVolumes(); if (k === 'fov' && this.app.session) this.app.session.camera.baseFov = x; });
    inp.addEventListener('change', () => this.app.saveSettings());
    return h('div.slider-row', inp, out);
  }

  toggle(k) {
    const v = this.app.settings[k];
    return h('button.toggle' + (v ? '.on' : ''), { type: 'button', onclick: () => { this.app.audio.play('click'); this.set(k, !v); } }, v ? 'On' : 'Off');
  }

  render() {
    const row = (label, ctl, note) => h('div.set-row', h('div.set-label', label, note ? h('small', note) : null), ctl);
    const sec = (title, ...rows) => h('div.panel.set-sec', h('h3', title), ...rows);
    clear(this.body);
    this.body.append(
      sec('Graphics',
        row('Quality', this.seg('quality', [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']]), this.app.settings.quality === 'auto' ? `Auto picked ${this.app.effectiveQuality()} for this device` : 'Lower this on Chromebooks and older laptops'),
        row('Show FPS', this.toggle('showFps'))),
      sec('Camera',
        row('View', this.seg('camera', [['chase', 'Chase'], ['far', 'Far'], ['hood', 'Hood']])),
        row('Field of view', this.slider('fov', 55, 95, 1, (v) => Math.round(v) + '°')),
        row('Camera shake', this.toggle('shake'))),
      sec('Audio',
        row('Master', this.slider('master', 0, 1, 0.01)),
        row('Music', this.slider('music', 0, 1, 0.01)),
        row('Effects', this.slider('sfx', 0, 1, 0.01))),
      sec('Gameplay',
        row('Speed units', this.seg('units', [['kmh', 'km/h'], ['mph', 'mph']])),
        row('Ghost of your best run', this.toggle('ghost'), 'Time trials only'),
        row('Touch controls', this.seg('touch', [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']]))),
      sec('Controls',
        h('div.keys',
          ...[['Accelerate', 'W / ↑', 'RT'], ['Brake / reverse', 'S / ↓', 'LT'], ['Steer', 'A D / ← →', 'Left stick'], ['Drift (handbrake)', 'Space / Shift', 'RB'],
            ['Respawn at checkpoint', 'R / Enter', 'B'], ['Restart (time trial)', 'Backspace', 'Back'], ['Change camera', 'C', 'X'], ['Look back', 'Q', ''], ['Pause', 'Esc / P', 'Start']]
            .map(([a, k, p]) => h('div.key-row', h('span', a), h('kbd', k), p ? h('kbd.pad', p) : h('span')))),
        h('p.note', 'In the air, accelerate/brake pitch the car and steering spins it - use it to line up landings.')),
      sec('Data',
        row('Reset records and ghosts', button('Reset', () => this.reset(), 'danger small')),
        row('Restore default settings', button('Defaults', () => { Object.assign(this.app.settings, DEFAULT_SETTINGS, { name: this.app.settings.name }); this.app.setQuality(this.app.settings.quality); this.app.audio.applyVolumes(); this.render(); }, 'small'))),
    );
  }

  reset() {
    if (!confirm('Delete all best times, medals and ghosts? Your car and settings are kept.')) return;
    this.app.records = {};
    this.app.saveRecords();
    try { for (const k of Object.keys(localStorage)) if (k.startsWith('polytrack.ghost.')) localStorage.removeItem(k); } catch { /* ignore */ }
    this.ui.toast('Records reset');
  }
}
