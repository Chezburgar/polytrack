// Keyboard, gamepad and touch merged into one driving state plus one-shot
// actions. Keys are read by `code` so layouts (AZERTY etc.) still work by
// physical position; Ctrl/Alt combinations are never bound.
export const DEFAULT_KEYS = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space', 'ShiftLeft', 'ShiftRight'],
  chat: ['Enter', 'KeyT'],
  restart: ['Backspace', 'Delete'],
  camera: ['KeyC'],
  pause: ['Escape', 'KeyP'],
  lookBack: ['KeyQ'],
};

export class Input {
  constructor(target = window) {
    this.keys = new Set();
    this.bindings = structuredClone(DEFAULT_KEYS);
    this.actions = new Map(); // action -> [callbacks]
    this.touch = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    this.enabled = true;
    this.lastDevice = 'keyboard';
    this.padIndex = null;
    this.prevPadButtons = [];
    this._down = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!this.keys.has(e.code)) this._fire(e.code);
      this.keys.add(e.code);
      this.lastDevice = 'keyboard';
      if (this.enabled && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace'].includes(e.code)) e.preventDefault();
    };
    this._up = (e) => { this.keys.delete(e.code); };
    this._blur = () => this.keys.clear();
    target.addEventListener('keydown', this._down);
    target.addEventListener('keyup', this._up);
    window.addEventListener('blur', this._blur);
  }

  on(action, fn) {
    if (!this.actions.has(action)) this.actions.set(action, []);
    this.actions.get(action).push(fn);
    return () => { const a = this.actions.get(action); a.splice(a.indexOf(fn), 1); };
  }

  _fire(code) {
    for (const [action, codes] of Object.entries(this.bindings)) {
      if (codes.includes(code)) this.emit(action);
    }
  }

  emit(action) {
    const list = this.actions.get(action);
    if (list) for (const fn of list.slice()) fn();
  }

  held(action) {
    const codes = this.bindings[action];
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  // poll gamepads; call once per frame
  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) if (p && p.connected && p.mapping === 'standard') { pad = p; break; }
    if (!pad) for (const p of pads) if (p && p.connected) { pad = p; break; }
    this.pad = pad;
    if (!pad) return;
    const b = (i) => (pad.buttons[i] ? pad.buttons[i].value : 0);
    const pressed = pad.buttons.map((x) => x.pressed);
    const edge = (i) => pressed[i] && !this.prevPadButtons[i];
    if (edge(2)) this.emit('camera');
    if (edge(9)) this.emit('pause');
    if (edge(8)) this.emit('restart');
    if (edge(12)) this.emit('menuUp');
    if (edge(13)) this.emit('menuDown');
    if (edge(0)) this.emit('menuSelect');
    this.prevPadButtons = pressed;
    const ax = pad.axes[0] || 0;
    const active = Math.abs(ax) > 0.15 || b(7) > 0.05 || b(6) > 0.05 || b(0) > 0.5;
    if (active) this.lastDevice = 'gamepad';
  }

  // Merged driving state. Analog wins when a stick is actually deflected.
  state() {
    const s = { throttle: 0, brake: 0, steer: 0, handbrake: 0, analog: false, lookBack: false };
    if (!this.enabled) return s;
    if (this.held('throttle')) s.throttle = 1;
    if (this.held('brake')) s.brake = 1;
    if (this.held('left')) s.steer += 1;
    if (this.held('right')) s.steer -= 1;
    if (this.held('handbrake')) s.handbrake = 1;
    s.lookBack = this.held('lookBack');
    const pad = this.pad;
    if (pad) {
      const ax = pad.axes[0] || 0;
      const dz = 0.12;
      if (Math.abs(ax) > dz) {
        const v = (Math.abs(ax) - dz) / (1 - dz);
        s.steer = -Math.sign(ax) * Math.pow(v, 1.4);
        s.analog = true;
      }
      const rt = pad.buttons[7] ? pad.buttons[7].value : 0;
      const lt = pad.buttons[6] ? pad.buttons[6].value : 0;
      s.throttle = Math.max(s.throttle, rt, pad.buttons[0]?.pressed ? 1 : 0);
      s.brake = Math.max(s.brake, lt);
      if (pad.buttons[5]?.pressed || pad.buttons[4]?.pressed) s.handbrake = 1;
    }
    const t = this.touch;
    if (t.active) {
      s.throttle = Math.max(s.throttle, t.throttle);
      s.brake = Math.max(s.brake, t.brake);
      if (t.steer) { s.steer = t.steer; s.analog = t.analogSteer || false; }
      s.handbrake = Math.max(s.handbrake, t.handbrake);
    }
    s.steer = Math.max(-1, Math.min(1, s.steer));
    return s;
  }

  dispose() {
    window.removeEventListener('keydown', this._down);
    window.removeEventListener('keyup', this._up);
    window.removeEventListener('blur', this._blur);
  }
}
