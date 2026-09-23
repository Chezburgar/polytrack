// On-screen controls for touch screens (phones, tablets, touch Chromebooks).
import { h } from './dom.js';

export class TouchControls {
  constructor(app) {
    this.app = app;
    const t = app.input.touch;
    const pad = (cls, label, onDown, onUp) => {
      const b = h('div.tbtn.' + cls, label);
      const ids = new Set();
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); ids.add(e.pointerId); b.setPointerCapture(e.pointerId); b.classList.add('on'); onDown(); });
      const up = (e) => { if (!ids.delete(e.pointerId)) return; if (!ids.size) { b.classList.remove('on'); onUp?.(); } };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
      return b;
    };
    let l = 0, r = 0;
    const steer = () => { t.steer = l - r; };
    this.el = h('div.touch',
      h('div.touch-left',
        pad('left', '◀', () => { l = 1; steer(); }, () => { l = 0; steer(); }),
        pad('right', '▶', () => { r = 1; steer(); }, () => { r = 0; steer(); })),
      h('div.touch-right',
        pad('drift', 'DRIFT', () => { t.handbrake = 1; }, () => { t.handbrake = 0; }),
        pad('brake', 'BRAKE', () => { t.brake = 1; }, () => { t.brake = 0; }),
        pad('gas', 'GAS', () => { t.throttle = 1; }, () => { t.throttle = 0; })),
      h('div.touch-top',
        pad('resp', '↺', () => app.input.emit('respawn')),
        pad('pause', 'II', () => app.input.emit('pause'))));
    this.active = false;
    this.refresh();
  }

  enabled() {
    const s = this.app.settings.touch;
    if (s === 'on') return true;
    if (s === 'off') return false;
    return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window && navigator.maxTouchPoints > 0 && matchMedia('(hover: none)').matches;
  }

  refresh() { this.el.classList.toggle('show', this.active && this.enabled()); this.app.input.touch.active = this.active && this.enabled(); }
  setActive(a) { this.active = a; this.refresh(); }
  update() {}
}
