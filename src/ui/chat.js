// In-race chat for online rooms: the last few messages over the HUD (they fade
// after a while), and a line to type in - Enter or T opens it, Enter sends,
// Esc closes. Driving keys are released while you type.
import { h } from './dom.js';

const SHOW_FOR = 9; // seconds a message stays up when you're not typing

export class ChatOverlay {
  constructor(app) {
    this.app = app;
    this.log = h('div.hc-log');
    this.input = h('input.hc-input', { type: 'text', maxLength: 140, placeholder: 'Say something - Enter to send, Esc to close', autocomplete: 'off', spellcheck: false });
    this.el = h('div.hud-chat', this.log, h('div.hc-row', this.input));
    this.lines = [];
    this.typing = false;
    this.t = 0;
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { this.send(); this.close(); }
      else if (e.key === 'Escape') this.close();
    });
    this.input.addEventListener('blur', () => this.close());
  }

  attach(net) {
    this.detach();
    this.net = net;
    this.lines = [];
    this.log.replaceChildren();
    if (!net) return;
    for (const m of net.chatLog.slice(-4)) this.add(m, -SHOW_FOR); // backlog, already faded
    this.off = net.on((kind, m) => { if (kind === 'chat') this.add(m, this.t); });
  }

  detach() { this.off?.(); this.off = null; this.net = null; this.close(); }

  add(m, at) {
    const line = m.sys ? h('div.hc-line.sys', m.text) : h('div.hc-line', h('b', { style: { color: m.color || '#9cf' } }, m.name + ':'), ' ', m.text);
    this.log.append(line);
    this.lines.push({ el: line, at });
    while (this.lines.length > 8) this.lines.shift().el.remove();
  }

  open() {
    if (!this.net || this.typing) return;
    this.typing = true;
    this.el.classList.add('typing');
    this.app.input.keys.clear(); // let go of the throttle while typing
    this.input.value = '';
    this.input.focus({ preventScroll: true });
  }

  close() {
    if (!this.typing) return;
    this.typing = false;
    this.el.classList.remove('typing');
    if (document.activeElement === this.input) this.input.blur();
  }

  send() {
    const text = this.input.value.trim();
    if (text && this.net) this.net.chat(text);
    this.input.value = '';
  }

  update(dt) {
    this.t += dt;
    for (const l of this.lines) l.el.classList.toggle('old', !this.typing && this.t - l.at > SHOW_FOR);
  }
}

// one-tap messages for the lobby and results
export const QUICK_CHAT = ['GL HF', 'Ready?', 'One more!', 'GG', 'Nice race'];
