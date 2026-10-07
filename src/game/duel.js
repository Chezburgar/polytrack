// /1v1: a little build-and-shoot duel against whoever called it (a bot plays in
// their name). Side view: A/D move, W or Space jump, aim with the mouse and click
// to shoot, Q (or right click) puts up a wall, E a ramp - stand on ramps to take
// the high ground, peek over walls with a jump. Shield and health, damage
// numbers, 25 s on the clock (more health left wins). Lose and it's the omega yeet.
import { h } from '../ui/dom.js';

export const DUEL_TIME = 25;
const W = 960, H = 540, FLOOR = 470, G = 1500;
const SPEED = 270, JUMP = 640, BULLET = 1700, STEP = 40;
const WALL_H = 124, WALL_W = 16, RAMP_W = 140, RAMP_H = 118;
const BODY_W = 30, BODY_H = 78;
const INTRO = 3, OUTRO = 1.8;

export class Duel {
  // me / foe: { name, color }; done(won) once the result has been shown
  constructor(app, { me, foe }, done) {
    this.app = app;
    this.done = done;
    this.t = 0;
    this.left = DUEL_TIME;
    this.over = null; // 'won' | 'lost' once it's decided
    this.endT = 0;
    this.rnd = Math.random;
    const fighter = (x, face, who, bot) => ({ x, y: FLOOR, vx: 0, vy: 0, face, ground: true, hp: 100, sh: 50, cd: 0, build: 0, flash: 0, name: who.name, color: who.color, bot, aim: 0, mine: [] });
    this.me = fighter(200, 1, me, false);
    this.foe = fighter(760, -1, foe, true);
    this.builds = [];
    this.bullets = [];
    this.bits = []; // splinters, sparks
    this.nums = []; // damage numbers
    this.ai = { move: 0, next: 0.6, plan: 0, peek: 0, err: 0.1 };
    this.keys = new Set();
    this.mouse = { x: 760, y: 400, down: false };
    // ---- the page --------------------------------------------------------------------
    const btn = (label, key) => {
      const b = h('button.du-btn', { type: 'button' }, label);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.keys.add(key); if (key === 'Q') this.build(this.me, 'wall'); if (key === 'E') this.build(this.me, 'ramp'); });
      const up = () => this.keys.delete(key);
      b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up);
      return b;
    };
    this.el = h('div.duel',
      h('div.du-head', h('b', `1V1 vs ${foe.name.toUpperCase()}`), this.clockEl = h('i', '0:25')),
      this.canvas = h('canvas.du-canvas', { width: W, height: H }),
      h('div.du-pad', btn('◀', 'A'), btn('▶', 'D'), btn('JUMP', 'W'), btn('WALL', 'Q'), btn('RAMP', 'E')),
      h('div.du-help', 'A / D move · W jump · aim and click to shoot · Q wall · E ramp'));
    this.g = this.canvas.getContext('2d');
    app.ui.root.append(this.el);
    const at = (e) => { const r = this.canvas.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }; };
    this.canvas.addEventListener('pointermove', (e) => Object.assign(this.mouse, at(e)));
    this.canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      Object.assign(this.mouse, at(e));
      if (e.button === 2) this.build(this.me, 'wall');
      else this.mouse.down = true;
    });
    window.addEventListener('pointerup', (this._up = () => { this.mouse.down = false; }));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    const KEYS = { KeyA: 'A', ArrowLeft: 'A', KeyD: 'D', ArrowRight: 'D', KeyW: 'W', ArrowUp: 'W', Space: 'W', KeyQ: 'Q', KeyE: 'E' };
    this._key = (e) => {
      const k = KEYS[e.code];
      if (!k) return;
      e.preventDefault(); e.stopPropagation();
      if (e.type === 'keydown') {
        if (!this.keys.has(k) && k === 'Q') this.build(this.me, 'wall');
        if (!this.keys.has(k) && k === 'E') this.build(this.me, 'ramp');
        this.keys.add(k);
      } else this.keys.delete(k);
    };
    window.addEventListener('keydown', this._key, true);
    window.addEventListener('keyup', this._key, true);
    app.audio.play('lock');
    this.draw();
  }

  // ---- the world ------------------------------------------------------------------------
  // the height of the solid at column x (a ramp's slope, a wall's top), or null
  surface(b, x) {
    if (b.type === 'wall') return Math.abs(x - b.x) <= WALL_W / 2 ? b.base - WALL_H : null;
    const u = (x - b.x) / (b.dir * RAMP_W);
    return u >= 0 && u <= 1 ? b.base - RAMP_H * u : null;
  }

  // does a point sit inside a build?
  inside(b, x, y) {
    const s = this.surface(b, x);
    return s != null && y >= s && y <= b.base;
  }

  // would a fighter standing at x, feet y, overlap a build it can't step onto?
  blocked(x, y) {
    for (const b of this.builds) {
      for (const ex of [x - BODY_W / 2, x, x + BODY_W / 2]) {
        const s = this.surface(b, ex);
        if (s == null) continue;
        const step = b.type === 'ramp' ? STEP : 4;
        if (y > s + step && y - BODY_H < b.base) return true;
      }
    }
    return false;
  }

  build(f, type) {
    if (this.over || this.t < INTRO || f.build > 0 || f.hp <= 0) return;
    f.build = 0.3;
    const dir = f.face;
    const x = type === 'wall' ? f.x + dir * 46 : f.x + dir * 18;
    const b = { type, x, base: f.y, dir, hp: type === 'wall' ? 90 : 110, max: type === 'wall' ? 90 : 110, owner: f, born: this.t };
    if (b.base - (type === 'wall' ? WALL_H : RAMP_H) < 40) return; // up against the sky
    this.builds.push(b);
    f.mine.push(b);
    if (f.mine.length > 8) this.breakBuild(f.mine[0], true);
    this.app.audio.play('thunk');
  }

  breakBuild(b, quiet = false) {
    this.builds.splice(this.builds.indexOf(b), 1);
    b.owner.mine.splice(b.owner.mine.indexOf(b), 1);
    if (quiet) return;
    for (let i = 0; i < 10; i++) {
      const x = b.type === 'wall' ? b.x : b.x + b.dir * RAMP_W * Math.random();
      this.bits.push({ x, y: b.base - Math.random() * (b.type === 'wall' ? WALL_H : RAMP_H), vx: (Math.random() - 0.5) * 300, vy: -Math.random() * 300, life: 0.8, color: '#a8743e', size: 8 });
    }
    this.app.audio.play('clunk');
  }

  shoot(f, ax, ay) {
    if (f.cd > 0 || f.hp <= 0) return;
    f.cd = f.bot ? 0.45 + this.rnd() * 0.2 : 0.3;
    const gx = f.x + f.face * 18, gy = f.y - 50;
    const a = Math.atan2(ay - gy, ax - gx) + (f.bot ? (this.rnd() - 0.5) * 2 * this.ai.err : 0);
    this.bullets.push({ x: gx, y: gy, vx: Math.cos(a) * BULLET, vy: Math.sin(a) * BULLET, by: f, life: 0.8, trail: [] });
    this.app.audio.play('pew');
  }

  hurt(f, dmg, x, y, head) {
    let left = dmg;
    const fromShield = Math.min(f.sh, left);
    f.sh -= fromShield; left -= fromShield;
    f.hp = Math.max(0, f.hp - left);
    f.flash = 0.12;
    this.nums.push({ x, y: y - 10, text: String(dmg), life: 0.9, color: head ? '#ffd23c' : fromShield > 0 ? '#7ac8ff' : '#ffffff', big: head });
    if (f === this.foe) this.app.audio.play('hitmark');
  }

  // ---- time ---------------------------------------------------------------------------------
  update(dt) {
    dt = Math.min(dt, 1 / 30);
    this.t += dt;
    if (this.t > INTRO && !this.over) {
      this.left = Math.max(0, this.left - dt);
      this.control(dt);
      this.brain(dt);
      for (const f of [this.me, this.foe]) this.move(f, dt);
      this.fly(dt);
      if (this.me.hp <= 0 || this.foe.hp <= 0 || this.left <= 0) {
        const won = this.foe.hp <= 0 ? true : this.me.hp <= 0 ? false : this.me.hp + this.me.sh > this.foe.hp + this.foe.sh;
        this.finish(won);
      }
    } else if (this.over) {
      this.endT += dt;
      this.fly(dt);
      if (this.endT > OUTRO && !this.reported) { this.reported = true; this.done(this.over === 'won'); this.dispose(); }
    }
    for (const p of this.bits) { p.life -= dt; p.vy += G * 0.6 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    this.bits = this.bits.filter((p) => p.life > 0);
    for (const n of this.nums) { n.life -= dt; n.y -= 50 * dt; }
    this.nums = this.nums.filter((n) => n.life > 0);
    this.clockEl.textContent = `0:${String(Math.ceil(this.left)).padStart(2, '0')}`;
    this.draw();
  }

  finish(won) {
    this.over = won ? 'won' : 'lost';
    const f = won ? this.foe : this.me;
    for (let i = 0; i < 24; i++) this.bits.push({ x: f.x, y: f.y - 40, vx: (Math.random() - 0.5) * 500, vy: -Math.random() * 500, life: 1.2, color: won ? '#7ac8ff' : '#ff6a4a', size: 6 });
    this.app.audio.play(won ? 'finish' : 'buzz');
  }

  // you
  control(dt) {
    const f = this.me, k = this.keys;
    f.vx = ((k.has('D') ? 1 : 0) - (k.has('A') ? 1 : 0)) * SPEED;
    if (k.has('W') && f.ground) { f.vy = -JUMP; f.ground = false; }
    f.face = this.mouse.x >= f.x ? 1 : -1;
    f.aim = Math.atan2(this.mouse.y - (f.y - 50), this.mouse.x - f.x);
    if (this.mouse.down) this.shoot(f, this.mouse.x, this.mouse.y);
  }

  // the bot: keep its distance, wall up when shot at, take the high ground, peek and shoot
  brain(dt) {
    const f = this.foe, me = this.me, ai = this.ai;
    ai.err = Math.max(0.045, 0.11 - this.t * 0.003); // it warms up
    f.face = me.x >= f.x ? 1 : -1;
    f.aim = Math.atan2(me.y - 50 - (f.y - 50), me.x - f.x);
    const d = Math.abs(me.x - f.x);
    ai.next -= dt;
    if (ai.next <= 0) {
      ai.next = 0.5 + this.rnd() * 0.7;
      ai.move = d < 300 ? -f.face : d > 520 ? f.face : [0, 1, -1][(this.rnd() * 3) | 0];
      if (f.ground && this.rnd() < 0.35) { f.vy = -JUMP; f.ground = false; }
    }
    // incoming: put a wall up
    const incoming = this.bullets.some((b) => b.by === me && Math.sign(b.vx) === Math.sign(f.x - b.x) && Math.abs(f.x - b.x) < 260);
    if (incoming && this.rnd() < dt * 7) this.build(f, 'wall');
    // now and then take height: a ramp toward you, and run up it
    ai.plan -= dt;
    if (ai.plan <= 0 && f.ground) {
      ai.plan = 2.5 + this.rnd() * 2.5;
      if (f.y > 200) { this.build(f, 'ramp'); ai.climb = 0.7; }
    }
    if (ai.climb > 0) { ai.climb -= dt; ai.move = f.face; }
    f.vx = ai.move * SPEED * 0.85;
    // shoot: through a wall in the way it jumps to peek first
    const gy = f.y - 50, ty = me.y - 45;
    const clear = !this.builds.some((b) => { for (let k = 1; k < 12; k++) { const x = f.x + ((me.x - f.x) * k) / 12, y = gy + ((ty - gy) * k) / 12; if (this.inside(b, x, y)) return true; } return false; });
    if (!clear && f.ground && this.rnd() < dt * 2.5) { f.vy = -JUMP; f.ground = false; }
    if (clear || this.rnd() < dt * 0.8) this.shoot(f, me.x, ty);
  }

  move(f, dt) {
    f.cd -= dt; f.build -= dt; f.flash -= dt;
    if (f.hp <= 0) return;
    // across (not into a wall or the steep side of a ramp)
    const nx = Math.max(24, Math.min(W - 24, f.x + f.vx * dt));
    if (!this.blocked(nx, f.y)) f.x = nx;
    // down (onto the floor, a ramp, the top of a wall)
    const was = f.y;
    f.vy += G * dt;
    let y = f.y + f.vy * dt;
    f.ground = false;
    if (f.vy >= 0) {
      let land = FLOOR;
      for (const b of this.builds) {
        const s = this.surface(b, f.x);
        if (s != null && was <= s + (b.type === 'ramp' ? STEP : 6) && s < land) land = s;
      }
      if (y >= land) { y = land; f.vy = 0; f.ground = true; }
    } else if (y < 40) { y = 40; f.vy = 0; }
    f.y = y;
  }

  fly(dt) {
    for (const b of this.bullets) {
      const n = 6;
      for (let i = 0; i < n && b.life > 0; i++) {
        b.x += (b.vx * dt) / n; b.y += (b.vy * dt) / n;
        if (b.x < 0 || b.x > W || b.y < 0 || b.y > FLOOR) { b.life = 0; break; }
        const hitB = this.builds.find((s) => this.inside(s, b.x, b.y));
        if (hitB) {
          b.life = 0;
          hitB.hp -= b.by.bot ? 16 : 22;
          for (let k = 0; k < 3; k++) this.bits.push({ x: b.x, y: b.y, vx: -Math.sign(b.vx) * Math.random() * 200, vy: -Math.random() * 200, life: 0.4, color: '#d8a868', size: 4 });
          if (hitB.hp <= 0) this.breakBuild(hitB);
          break;
        }
        for (const f of [this.me, this.foe]) {
          if (f === b.by || f.hp <= 0 || this.over) continue;
          if (Math.abs(b.x - f.x) < BODY_W / 2 + 2 && b.y > f.y - BODY_H && b.y < f.y) {
            b.life = 0;
            const head = b.y < f.y - BODY_H + 20;
            const base = b.by.bot ? 16 : 22;
            this.hurt(f, head ? base * 2 : base, b.x, b.y, head);
            break;
          }
        }
      }
      b.life -= dt;
      b.trail.unshift([b.x, b.y]); b.trail.length = Math.min(b.trail.length, 3);
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);
  }

  // ---- drawing ------------------------------------------------------------------------------
  draw() {
    const g = this.g;
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#3a8ae8'); sky.addColorStop(1, '#a8dcff');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    // hills, the island
    g.fillStyle = '#6ab0e0';
    g.beginPath(); g.moveTo(0, 380); for (let x = 0; x <= W; x += 60) g.lineTo(x, 360 - Math.sin(x * 0.012) * 40 - Math.sin(x * 0.031) * 18); g.lineTo(W, FLOOR); g.lineTo(0, FLOOR); g.fill();
    g.fillStyle = '#5aa83a'; g.fillRect(0, FLOOR, W, 14);
    g.fillStyle = '#8a5a32'; g.fillRect(0, FLOOR + 14, W, H - FLOOR);
    // builds
    for (const b of this.builds) {
      const dmg = 1 - b.hp / b.max;
      g.fillStyle = b.owner.bot ? '#b07a44' : '#c08a50';
      g.strokeStyle = '#6a4220'; g.lineWidth = 2;
      g.beginPath();
      if (b.type === 'wall') g.rect(b.x - WALL_W / 2, b.base - WALL_H, WALL_W, WALL_H);
      else { g.moveTo(b.x, b.base); g.lineTo(b.x + b.dir * RAMP_W, b.base); g.lineTo(b.x + b.dir * RAMP_W, b.base - RAMP_H); g.closePath(); }
      g.fill(); g.stroke();
      // planks
      g.strokeStyle = 'rgba(80,48,20,0.6)'; g.lineWidth = 1.5;
      if (b.type === 'wall') for (let k = 1; k < 5; k++) { g.beginPath(); g.moveTo(b.x - WALL_W / 2, b.base - (WALL_H * k) / 5); g.lineTo(b.x + WALL_W / 2, b.base - (WALL_H * k) / 5); g.stroke(); }
      else for (let k = 1; k < 5; k++) { const x = b.x + (b.dir * RAMP_W * k) / 5; g.beginPath(); g.moveTo(x, b.base); g.lineTo(x, b.base - (RAMP_H * k) / 5); g.stroke(); }
      if (dmg > 0.3) { g.strokeStyle = 'rgba(30,16,4,0.8)'; g.beginPath(); const cx = b.type === 'wall' ? b.x : b.x + b.dir * RAMP_W * 0.7, cy = b.base - 50; g.moveTo(cx - 6, cy - 14); g.lineTo(cx + 3, cy); g.lineTo(cx - 4, cy + 12); g.stroke(); }
    }
    // fighters
    for (const f of [this.me, this.foe]) this.drawFighter(g, f);
    // bullets
    g.strokeStyle = '#fff6a0'; g.lineWidth = 3;
    for (const b of this.bullets) { const t = b.trail[b.trail.length - 1] || [b.x, b.y]; g.beginPath(); g.moveTo(t[0] - b.vx * 0.012, t[1] - b.vy * 0.012); g.lineTo(b.x, b.y); g.stroke(); }
    for (const p of this.bits) { g.globalAlpha = Math.min(1, p.life * 2); g.fillStyle = p.color; g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); }
    g.globalAlpha = 1;
    // damage numbers
    g.textAlign = 'center';
    for (const n of this.nums) {
      g.globalAlpha = Math.min(1, n.life * 2.5);
      g.font = `italic 900 ${n.big ? 34 : 26}px Arial, sans-serif`;
      g.lineWidth = 5; g.strokeStyle = '#1a1206'; g.strokeText(n.text, n.x, n.y);
      g.fillStyle = n.color; g.fillText(n.text, n.x, n.y);
    }
    g.globalAlpha = 1;
    // health bars
    this.bars(g, this.me, 24, H - 50, 'YOU');
    this.bars(g, this.foe, W - 284, 24, this.foe.name.toUpperCase());
    // the crosshair
    if (!this.over && this.t > INTRO) {
      const { x, y } = this.mouse;
      g.strokeStyle = '#fff'; g.lineWidth = 2;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { g.beginPath(); g.moveTo(x + dx * 5, y + dy * 5); g.lineTo(x + dx * 13, y + dy * 13); g.stroke(); }
    }
    // the intro and the result
    g.textAlign = 'center';
    if (this.t < INTRO) {
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, 0, W, H);
      const n = Math.ceil(INTRO - this.t);
      this.big(g, n > 2 ? '1V1' : String(n), W / 2, 250, n > 2 ? 110 : 140, '#ffd23c');
      this.big(g, n > 2 ? `vs ${this.foe.name}` : 'lose and you get omega yeeted', W / 2, 320, 30, '#fff');
    } else if (this.t < INTRO + 0.6) this.big(g, 'FIGHT!', W / 2, 270, 120, '#ffd23c');
    if (this.over) {
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, W, H);
      this.big(g, this.over === 'won' ? 'YOU WON THE 1V1' : 'ELIMINATED', W / 2, 250, this.over === 'won' ? 80 : 110, this.over === 'won' ? '#ffd23c' : '#ff5a4a');
      this.big(g, this.over === 'won' ? 'back to the race' : `by ${this.foe.name} · prepare to be omega yeeted`, W / 2, 315, 28, '#fff');
    }
  }

  big(g, text, x, y, size, color) {
    g.font = `italic 900 ${size}px Arial, sans-serif`;
    g.lineWidth = Math.max(4, size / 12); g.strokeStyle = '#120c04'; g.strokeText(text, x, y);
    g.fillStyle = color; g.fillText(text, x, y);
  }

  bars(g, f, x, y, label) {
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(x - 6, y - 20, 272, 46);
    g.font = '900 13px Arial, sans-serif'; g.textAlign = 'left'; g.fillStyle = '#fff'; g.fillText(label, x, y - 6);
    g.fillStyle = '#1a3a5a'; g.fillRect(x, y, 260, 8); g.fillStyle = '#4ab0ff'; g.fillRect(x, y, (260 * f.sh) / 50, 8);
    g.fillStyle = '#1a3a1a'; g.fillRect(x, y + 11, 260, 11); g.fillStyle = '#5ae05a'; g.fillRect(x, y + 11, (260 * f.hp) / 100, 11);
    g.textAlign = 'right'; g.fillStyle = '#fff'; g.fillText(`${Math.ceil(f.sh)} · ${Math.ceil(f.hp)}`, x + 260, y - 6);
  }

  drawFighter(g, f) {
    if (f.hp <= 0) return;
    const x = f.x, y = f.y, run = Math.abs(f.vx) > 1 && f.ground ? Math.sin(this.t * 16) * 6 : 0;
    g.save();
    // legs, body, arms
    g.fillStyle = '#2a2d34';
    g.fillRect(x - 11 + run * 0.5, y - 32, 9, 32); g.fillRect(x + 2 - run * 0.5, y - 32, 9, 32);
    g.fillStyle = f.flash > 0 ? '#ffffff' : f.color;
    g.fillRect(x - 15, y - 66, 30, 36);
    g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillRect(x - 15, y - 40, 30, 4); // a stripe
    // the gun, along the aim
    g.translate(x, y - 50);
    g.rotate(f.aim);
    g.fillStyle = '#1a1a1a'; g.fillRect(4, -4, 34, 8); g.fillRect(10, 2, 7, 10);
    g.restore();
    // head with a visor
    g.fillStyle = '#e8b88a'; g.fillRect(x - 10, y - 86, 20, 20);
    g.fillStyle = f.color; g.fillRect(x - 12, y - 90, 24, 9);
    g.fillStyle = '#1a1a1a'; g.fillRect(x + (f.face > 0 ? 1 : -9), y - 80, 8, 5);
    // name
    g.font = '900 13px Arial, sans-serif'; g.textAlign = 'center'; g.fillStyle = '#fff';
    g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.6)'; g.strokeText(f.bot ? f.name : 'YOU', x, y - 98); g.fillText(f.bot ? f.name : 'YOU', x, y - 98);
  }

  dispose() {
    window.removeEventListener('keydown', this._key, true);
    window.removeEventListener('keyup', this._key, true);
    window.removeEventListener('pointerup', this._up);
    const el = this.el;
    el.classList.add('leave');
    setTimeout(() => el.remove(), 400);
  }
}
