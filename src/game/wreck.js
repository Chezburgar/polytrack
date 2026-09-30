// Wrecks and the ways to get one: a precalc pop quiz (get it wrong and the car
// overheats, catches fire and blows up), and the rebuild minigame that follows
// a /crash or a failed quiz - drag the parts back onto the frame, bolt the
// wheels on, and get the engine to start. Everything here is on-screen UI; the
// cars themselves are handled in pranks.js.
import { h } from '../ui/dom.js';

export const QUIZ_TIME = 15;
export const REBUILD_MAX = 75; // the crew take pity after this long

// ---- precalc questions ----------------------------------------------------------------
const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];
const int = (a, b, rnd) => a + Math.floor(rnd() * (b - a + 1));

// { q, options: [4 strings], answer: index }
export function makeQuestion(rnd = Math.random) {
  const kinds = [logQ, trigQ, expQ, composeQ, inverseQ, vertexQ, periodQ, domainQ];
  const { q, right, wrong } = pick(kinds, rnd)(rnd);
  const opts = [right];
  for (const w of wrong) if (!opts.includes(w) && opts.length < 4) opts.push(w);
  for (const w of ['0', '1', '−1', 'undefined']) if (!opts.includes(w) && opts.length < 4) opts.push(w);
  // shuffle
  for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [opts[i], opts[j]] = [opts[j], opts[i]]; }
  return { q, options: opts, answer: opts.indexOf(right) };
}

function logQ(rnd) {
  const b = pick([2, 3, 5, 10], rnd), k = int(2, b === 10 ? 4 : b === 2 ? 6 : 4, rnd);
  const n = b ** k;
  return { q: `log<sub>${b}</sub>(${n}) = ?`, right: String(k), wrong: [String(k + 1), String(k - 1), String(n / b)] };
}
function trigQ(rnd) {
  const rows = [
    ['sin(π/6)', '1/2', ['√3/2', '√2/2', '1']], ['cos(π/3)', '1/2', ['√3/2', '0', '−1/2']],
    ['sin(π/4)', '√2/2', ['1/2', '√3/2', '1']], ['cos(π/6)', '√3/2', ['1/2', '√2/2', '√3']],
    ['tan(π/4)', '1', ['0', '√3', '√2/2']], ['sin(π)', '0', ['1', '−1', 'π']],
    ['cos(π)', '−1', ['0', '1', '1/2']], ['sin(3π/2)', '−1', ['1', '0', '−1/2']],
    ['tan(π/3)', '√3', ['1/√3', '1', '√3/2']], ['cos(2π/3)', '−1/2', ['1/2', '√3/2', '−√3/2']],
  ];
  const [q, r, w] = pick(rows, rnd);
  return { q: `${q} = ?`, right: r, wrong: w };
}
function expQ(rnd) {
  const b = pick([2, 3, 4, 5], rnd), x = int(2, b === 2 ? 6 : 4, rnd);
  return { q: `Solve for x:  ${b}<sup>x</sup> = ${b ** x}`, right: String(x), wrong: [String(x + 1), String(x - 1), String(b * x)] };
}
function composeQ(rnd) {
  const a = int(2, 5, rnd), c = int(-4, 6, rnd) || 1, x = int(-3, 4, rnd);
  const g = x * x, f = a * g + c;
  return {
    q: `f(x) = ${a}x ${c < 0 ? '−' : '+'} ${Math.abs(c)},  g(x) = x²<br>f(g(${x})) = ?`,
    right: String(f), wrong: [String((a * x + c) ** 2), String(a * x * x - c), String(a * x + c)],
  };
}
function inverseQ(rnd) {
  const a = int(2, 6, rnd), b = int(1, 9, rnd), x = int(1, 7, rnd);
  const y = a * x + b;
  return { q: `f(x) = ${a}x + ${b}<br>f<sup>−1</sup>(${y}) = ?`, right: String(x), wrong: [String(a * y + b), String(x + 1), String(y - b)] };
}
function vertexQ(rnd) {
  const hx = int(-5, 5, rnd) || 2, k = int(-6, 6, rnd);
  const b = -2 * hx, c = hx * hx + k;
  const sg = (v) => (v < 0 ? `− ${-v}` : `+ ${v}`);
  return { q: `Vertex of  y = x² ${sg(b)}x ${sg(c)}`, right: `(${hx}, ${k})`, wrong: [`(${-hx}, ${k})`, `(${hx}, ${c})`, `(${b}, ${k})`] };
}
function periodQ(rnd) {
  const k = pick([2, 3, 4, 6], rnd);
  const fn = pick(['sin', 'cos'], rnd);
  return { q: `Period of  y = ${fn}(${k}x)`, right: `2π/${k}`, wrong: [`π/${k}`, `${k}π`, `2π`] };
}
function domainQ(rnd) {
  const a = int(1, 9, rnd);
  return { q: `Domain of  f(x) = √(x − ${a})`, right: `x ≥ ${a}`, wrong: [`x > ${a}`, `x ≤ ${a}`, `all real x`] };
}

// ---- the quiz panel -------------------------------------------------------------------
// Answer with 1-4 (or a click) while you keep driving. done(correct)
export class Quiz {
  constructor(app, question, done) {
    this.app = app;
    this.qn = question;
    this.done = done;
    this.t = 0;
    this.over = false;
    this.buttons = question.options.map((o, i) => h('button.qz-opt', { type: 'button', onclick: () => this.answer(i) }, h('b', String(i + 1)), h('span', { html: o })));
    this.el = h('div.quiz',
      h('div.qz-head', h('b', '📐 PRECALC POP QUIZ'), h('span', 'press 1-4')),
      h('div.qz-q', { html: question.q }),
      h('div.qz-opts', ...this.buttons),
      this.bar = h('div.qz-bar', h('i')),
      this.msg = h('div.qz-msg', 'Wrong answer and your engine melts.'));
    app.ui.root.append(this.el);
    this._key = (e) => {
      const m = /^(?:Digit|Numpad)([1-4])$/.exec(e.code);
      if (m) { e.preventDefault(); this.answer(+m[1] - 1); }
    };
    window.addEventListener('keydown', this._key, true);
    app.audio.play('quiz');
  }

  update(dt) {
    if (this.over) return;
    this.t += dt;
    this.bar.firstChild.style.transform = `scaleX(${Math.max(0, 1 - this.t / QUIZ_TIME).toFixed(3)})`;
    if (this.t >= QUIZ_TIME) this.answer(-1);
  }

  answer(i) {
    if (this.over) return;
    this.over = true;
    const ok = i === this.qn.answer;
    this.buttons.forEach((b, k) => b.classList.add(k === this.qn.answer ? 'right' : k === i ? 'wrong' : 'dim'));
    this.el.classList.add(ok ? 'pass' : 'fail');
    this.msg.innerHTML = ok ? 'Correct! Your engine lives.' : i < 0 ? 'Out of time! Your engine is overheating…' : 'Wrong! Your engine is overheating…';
    this.app.audio.play(ok ? 'ding' : 'buzz');
    this.dispose(2.2);
    this.done(ok);
  }

  dispose(after = 0) {
    window.removeEventListener('keydown', this._key, true);
    const el = this.el;
    setTimeout(() => { el.classList.add('leave'); setTimeout(() => el.remove(), 400); }, after * 1000);
  }
}

// ---- the rebuild minigame -----------------------------------------------------------------
// Parts in a side view of the car. Slots are where they go (frame coords, the
// frame is 800 x 340); shapes are small SVGs.
const PARTS = [
  { id: 'wheelR', label: 'rear wheel', x: 175, y: 250, w: 110, h: 110, wheel: true },
  { id: 'wheelF', label: 'front wheel', x: 620, y: 250, w: 110, h: 110, wheel: true },
  { id: 'engine', label: 'engine', x: 600, y: 150, w: 150, h: 80 },
  { id: 'door', label: 'door', x: 390, y: 170, w: 170, h: 110 },
  { id: 'bonnet', label: 'bonnet', x: 620, y: 105, w: 170, h: 34 },
  { id: 'spoiler', label: 'spoiler', x: 120, y: 70, w: 130, h: 50 },
];
const JUNK = [{ id: 'duck', label: 'rubber duck', w: 70, h: 64 }, { id: 'toaster', label: 'toaster', w: 90, h: 70 }];
const SVG = {
  wheelR: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="#1b1c1f"/><circle cx="50" cy="50" r="30" fill="#b8bec8"/><circle cx="50" cy="50" r="9" fill="#555"/></svg>',
  wheelF: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="#1b1c1f"/><circle cx="50" cy="50" r="30" fill="#b8bec8"/><circle cx="50" cy="50" r="9" fill="#555"/></svg>',
  engine: '<svg viewBox="0 0 150 80"><rect x="6" y="18" width="138" height="56" rx="6" fill="#6a6f78"/><rect x="18" y="4" width="26" height="18" fill="#8a8f98"/><rect x="62" y="4" width="26" height="18" fill="#8a8f98"/><rect x="106" y="4" width="26" height="18" fill="#8a8f98"/><rect x="20" y="34" width="110" height="10" fill="#c9433a"/></svg>',
  door: '<svg viewBox="0 0 170 110"><path d="M6 20 L150 10 L166 104 L6 104 Z" fill="var(--paint)"/><path d="M20 26 L136 20 L144 54 L20 54 Z" fill="#9fd4f0"/><rect x="120" y="66" width="24" height="6" rx="3" fill="#222"/></svg>',
  bonnet: '<svg viewBox="0 0 170 34"><path d="M2 30 L20 4 L168 12 L168 30 Z" fill="var(--paint)"/></svg>',
  spoiler: '<svg viewBox="0 0 130 50"><rect x="4" y="4" width="122" height="14" rx="3" fill="#222"/><rect x="20" y="16" width="10" height="32" fill="#333"/><rect x="100" y="16" width="10" height="32" fill="#333"/></svg>',
  duck: '<svg viewBox="0 0 70 64"><ellipse cx="34" cy="44" rx="30" ry="18" fill="#ffd23c"/><circle cx="48" cy="20" r="15" fill="#ffd23c"/><path d="M60 20 L70 24 L60 28 Z" fill="#ff8a1a"/><circle cx="52" cy="16" r="3" fill="#111"/></svg>',
  toaster: '<svg viewBox="0 0 90 70"><rect x="4" y="14" width="82" height="54" rx="10" fill="#c8ccd2"/><rect x="18" y="6" width="22" height="14" fill="#c89a5a"/><rect x="50" y="6" width="22" height="14" fill="#c89a5a"/><rect x="76" y="32" width="12" height="6" fill="#333"/></svg>',
};

export class Rebuild {
  // paint: the car's colour; done(): the car is back together
  constructor(app, { paint = '#e8433a', name = '' } = {}, done) {
    this.app = app;
    this.done = done;
    this.t = 0;
    this.stage = 'parts';
    this.bolts = 0;
    this.boltDropped = false;
    this.stalls = 0;
    this.frame = h('div.rb-frame', { html: '<svg class="rb-chassis" viewBox="0 0 800 340"><path d="M60 250 L60 150 L150 120 L300 70 L520 64 L640 110 L760 130 L770 250 Z" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="4" stroke-dasharray="14 10"/><rect x="60" y="238" width="710" height="16" fill="#3a3d44"/></svg>' });
    this.frame.style.setProperty('--paint', paint);
    this.slots = new Map();
    for (const p of PARTS) {
      const s = h('div.rb-slot', { style: { left: `${p.x - p.w / 2}px`, top: `${p.y - p.h / 2}px`, width: `${p.w}px`, height: `${p.h}px` } }, h('span', p.label));
      this.frame.append(s);
      this.slots.set(p.id, s);
    }
    this.el = h('div.rebuild',
      h('div.rb-head', h('b', 'REBUILD YOUR CAR'), this.stepEl = h('span', 'Drag the parts back onto the frame'), this.clock = h('i', '0:00')),
      this.stageEl = h('div.rb-stage', this.frame),
      this.startBtn = h('button.rb-start', { type: 'button' }, h('i'), h('span', 'HOLD TO START ENGINE')),
      this.toastEl = h('div.rb-toast'));
    this.el.style.setProperty('--paint', paint);
    app.ui.root.append(this.el);
    // parts, scattered round the edges of the screen
    const W = innerWidth, H = innerHeight;
    this.parts = [...PARTS, ...JUNK].map((p, i) => {
      const el = h('div.rb-part' + (p.wheel ? '.wheel' : '') + (JUNK.includes(p) ? '.junk' : ''), { html: SVG[p.id], style: { width: `${p.w}px`, height: `${p.h}px` } });
      el.style.setProperty('--paint', paint);
      this.el.append(el);
      const side = i % 4;
      const x = side === 0 ? 30 + Math.random() * 120 : side === 1 ? W - 180 - Math.random() * 120 : 60 + Math.random() * (W - 260);
      const y = side === 2 ? 90 + Math.random() * 60 : side === 3 ? H - 170 - Math.random() * 60 : 120 + Math.random() * (H - 320);
      const part = { ...p, el, x, y, vx: p.wheel ? (Math.random() < 0.5 ? -1 : 1) * 60 : 0, vy: p.wheel ? 40 : 0, placed: false, junk: JUNK.includes(p) };
      this.place(part);
      this.drag(part);
      return part;
    });
    // the ignition: hold it; the first time it always stalls
    let holdT = 0;
    const down = (e) => { e.preventDefault(); if (this.stage !== 'start') return; this.holding = true; holdT = 0; this.app.audio.play('crank'); };
    const up = () => { this.holding = false; };
    this.startBtn.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    this._up = up;
    this.holdFill = this.startBtn.firstChild;
    this.hold = () => holdT;
    this.setHold = (v) => { holdT = v; };
  }

  say(text) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('on'); void this.toastEl.offsetWidth; this.toastEl.classList.add('on');
  }

  place(p) { p.el.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px)`; }

  drag(p) {
    let ox = 0, oy = 0;
    p.el.addEventListener('pointerdown', (e) => {
      if (p.placed) {
        // a placed wheel: its bolts get tightened by clicking it
        if (p.wheel && p.boltsLeft > 0) this.tighten(p);
        return;
      }
      e.preventDefault();
      p.el.setPointerCapture(e.pointerId);
      p.held = true;
      ox = e.clientX - p.x; oy = e.clientY - p.y;
      p.el.classList.add('held');
    });
    p.el.addEventListener('pointermove', (e) => { if (!p.held) return; p.x = e.clientX - ox; p.y = e.clientY - oy; this.place(p); });
    p.el.addEventListener('pointerup', () => { if (!p.held) return; p.held = false; p.el.classList.remove('held'); this.drop(p); });
  }

  // the slot's position on screen
  slotAt(id) {
    const r = this.slots.get(id).getBoundingClientRect();
    return { x: r.left, y: r.top, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }

  drop(p) {
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    if (p.junk) {
      // near any slot? nope
      for (const q of PARTS) { const s = this.slotAt(q.id); if (Math.hypot(s.cx - cx, s.cy - cy) < 70) { this.say(`A ${p.label} is not a car part.`); this.app.audio.play('buzz'); p.el.classList.add('shake'); setTimeout(() => p.el.classList.remove('shake'), 400); return; } }
      return;
    }
    const s = this.slotAt(p.id);
    if (Math.hypot(s.cx - cx, s.cy - cy) > 55) return;
    p.placed = true;
    p.x = s.x; p.y = s.y;
    this.place(p);
    p.el.classList.add('placed');
    this.slots.get(p.id).classList.add('filled');
    this.app.audio.play('clank');
    if (p.wheel) {
      p.boltsLeft = 4;
      p.el.append(...[0, 1, 2, 3].map((k) => h('i.rb-bolt', { style: { left: `${50 + Math.cos(k * Math.PI / 2 + 0.78) * 28}%`, top: `${50 + Math.sin(k * Math.PI / 2 + 0.78) * 28}%` } })));
      this.say(`Click the ${p.label} to tighten its bolts`);
    }
    this.check();
  }

  tighten(p) {
    const bolt = [...p.el.querySelectorAll('.rb-bolt:not(.tight)')][0];
    if (!bolt) return;
    bolt.classList.add('tight');
    p.boltsLeft--;
    this.app.audio.play('ratchet');
    // one bolt, once, falls straight back out
    if (!this.boltDropped && p.boltsLeft === 1 && Math.random() < 0.7) {
      this.boltDropped = true;
      setTimeout(() => { bolt.classList.remove('tight'); p.boltsLeft++; this.say('A bolt fell out. Of course it did.'); this.app.audio.play('boing'); }, 350);
    }
    this.check();
  }

  check() {
    const left = PARTS.filter((q) => !this.parts.find((p) => p.id === q.id).placed).length;
    const loose = this.parts.filter((p) => p.wheel && p.placed && p.boltsLeft > 0).length;
    if (this.stage !== 'parts') return;
    if (left) this.stepEl.textContent = `Drag the parts back onto the frame - ${left} to go`;
    else if (loose) this.stepEl.textContent = 'Tighten the wheel bolts - click the wheels';
    else {
      this.stage = 'start';
      this.stepEl.textContent = 'Now start it';
      this.startBtn.classList.add('on');
      this.say('Hold the button to start the engine');
    }
  }

  update(dt) {
    this.t += dt;
    const s = Math.floor(this.t);
    this.clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    // loose wheels roll away when you're not holding them
    const W = innerWidth, H = innerHeight;
    for (const p of this.parts) {
      if (!p.wheel || p.placed || p.held) continue;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x < 0 || p.x > W - p.w) { p.vx = -p.vx; p.x = Math.max(0, Math.min(W - p.w, p.x)); }
      if (p.y < 60 || p.y > H - p.h - 10) { p.vy = -p.vy; p.y = Math.max(60, Math.min(H - p.h - 10, p.y)); }
      p.spin = (p.spin || 0) + p.vx * dt * 3;
      p.el.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px) rotate(${p.spin.toFixed(0)}deg)`;
    }
    // the ignition
    if (this.stage === 'start') {
      let v = this.hold();
      v = this.holding ? v + dt / 2 : Math.max(0, v - dt * 1.5);
      if (this.holding && this.stalls === 0 && v > 0.9) {
        this.stalls++; this.holding = false; v = 0;
        this.say('*cough cough* … it stalled. Try again.');
        this.app.audio.play('cough');
      }
      this.setHold(v);
      this.holdFill.style.transform = `scaleX(${Math.min(1, v).toFixed(3)})`;
      if (v >= 1) this.finish('VROOM! Back in the race');
    }
    if (this.t > REBUILD_MAX && this.stage !== 'done') this.finish('The crew took pity on you');
  }

  finish(text) {
    if (this.stage === 'done') return;
    this.stage = 'done';
    this.say(text);
    this.app.audio.play('rev');
    this.el.classList.add('fixed');
    setTimeout(() => { this.dispose(); this.done(); }, 900);
  }

  dispose() {
    window.removeEventListener('pointerup', this._up);
    this.el.classList.add('leave');
    const el = this.el;
    setTimeout(() => el.remove(), 400);
  }
}
