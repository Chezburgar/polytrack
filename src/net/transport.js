// Two interchangeable transports with the same small surface:
//   host(code) / join(code) -> Promise<selfId>
//   send(to, msg) / broadcast(msg) / close()
//   onPeer(id) onData(id, msg) onPeerLeave(id) onClose(reason) onError(err)
// PeerTransport: WebRTC data channels through the public PeerJS broker (works
//   across the internet; the host relays everything - a star topology).
// LocalTransport: BroadcastChannel, for several tabs of one browser.

export const PROTO = 'polytrack-v1';

// ICE servers (STUN + TURN relays) from Metered, so players behind strict
// networks can still connect through a relay. Fetched once; if the request
// fails we fall back to PeerJS's default STUN servers.
const TURN_URL = 'https://ggvault.metered.live/api/v1/turn/credentials?apiKey=59ed4b28ab73a921293dfaee47c2137ee3f3';
let icePromise = null;
export function iceServers() {
  if (!icePromise) {
    icePromise = (async () => {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 5000);
        const res = await fetch(TURN_URL, { signal: ctl.signal });
        clearTimeout(timer);
        const list = await res.json();
        if (Array.isArray(list) && list.length) return list;
      } catch (e) { console.warn('TURN credentials unavailable, using STUN only', e); }
      icePromise = null; // try again next time
      return null;
    })();
  }
  return icePromise;
}

class Base {
  constructor() {
    this.handlers = { peer: [], data: [], leave: [], close: [], error: [] };
    this.closed = false;
  }
  on(ev, fn) { this.handlers[ev].push(fn); }
  _emit(ev, ...a) { for (const fn of this.handlers[ev]) { try { fn(...a); } catch (e) { console.error(e); } } }
}

export class PeerTransport extends Base {
  constructor() {
    super();
    this.conns = new Map();
    this.peer = null;
  }

  _peer(id, ice) {
    const Peer = window.Peer;
    if (!Peer) throw new Error('Multiplayer library failed to load.');
    const opts = { debug: 1 };
    if (ice) opts.config = { iceServers: ice };
    return id ? new Peer(id, opts) : new Peer(opts);
  }

  async host(code) {
    this.role = 'host';
    const ice = await iceServers();
    return new Promise((resolve, reject) => {
      const peer = (this.peer = this._peer(`${PROTO}-${code}`.toLowerCase(), ice));
      let opened = false;
      peer.on('open', (id) => { opened = true; this.selfId = id; resolve(id); });
      peer.on('connection', (conn) => this._wire(conn));
      peer.on('error', (err) => {
        if (!opened) { reject(err); return; }
        if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') return; // broker hiccup: live channels survive
        this._emit('error', err);
      });
      peer.on('disconnected', () => { if (!this.closed) setTimeout(() => { try { peer.reconnect(); } catch { /* gone */ } }, 1500); });
    });
  }

  async join(code) {
    this.role = 'guest';
    const ice = await iceServers();
    return new Promise((resolve, reject) => {
      const peer = (this.peer = this._peer(null, ice));
      let done = false;
      const fail = (e) => { if (!done) { done = true; reject(e); } };
      const timer = setTimeout(() => fail(Object.assign(new Error('Timed out reaching the room. The host may be behind a strict firewall.'), { type: 'timeout' })), 15000);
      peer.on('open', (id) => {
        this.selfId = id;
        const conn = peer.connect(`${PROTO}-${code}`.toLowerCase(), { reliable: true, serialization: 'json' });
        conn.on('open', () => { if (done) return; done = true; clearTimeout(timer); this.hostId = conn.peer; resolve(id); });
        this._wire(conn);
      });
      peer.on('error', (err) => {
        if (err.type === 'peer-unavailable') fail(Object.assign(new Error('Room not found. Check the code.'), { type: 'not-found' }));
        else if (!done) fail(err);
        else this._emit('error', err);
      });
    });
  }

  _wire(conn) {
    conn.on('open', () => {
      this.conns.set(conn.peer, conn);
      if (this.role === 'host') this._emit('peer', conn.peer);
    });
    conn.on('data', (msg) => this._emit('data', conn.peer, msg));
    const gone = () => {
      if (!this.conns.has(conn.peer)) return;
      this.conns.delete(conn.peer);
      if (this.role === 'host') this._emit('leave', conn.peer);
      else if (!this.closed) this._emit('close', 'The host closed the room.');
    };
    conn.on('close', gone);
    conn.on('error', gone);
    // WebRTC can go silent without a close event; watch the ICE state too
    const pc = conn.peerConnection;
    if (pc) pc.addEventListener('iceconnectionstatechange', () => { if (['failed', 'closed'].includes(pc.iceConnectionState)) gone(); });
  }

  send(to, msg) { const c = this.conns.get(to); if (c && c.open) c.send(msg); }
  broadcast(msg, except = null) { for (const [id, c] of this.conns) if (id !== except && c.open) c.send(msg); }
  toHost(msg) { this.send(this.hostId, msg); }
  kick(id) { const c = this.conns.get(id); if (c) { c.close(); this.conns.delete(id); } }

  close() {
    this.closed = true;
    for (const c of this.conns.values()) { try { c.close(); } catch { /* ignore */ } }
    this.conns.clear();
    try { this.peer?.destroy(); } catch { /* ignore */ }
  }
}

export class LocalTransport extends Base {
  constructor() {
    super();
    this.selfId = 'L' + Math.random().toString(36).slice(2, 9);
    this.peers = new Set();
  }

  _open(code) {
    this.ch = new BroadcastChannel(`${PROTO}-${code}`);
    this.ch.onmessage = (e) => {
      const m = e.data;
      if (!m || m.from === this.selfId) return;
      if (m.to && m.to !== this.selfId) return;
      if (m.sys === 'knock' && this.role === 'host') {
        this.peers.add(m.from);
        this.ch.postMessage({ sys: 'welcome', from: this.selfId, to: m.from });
        this._emit('peer', m.from);
        return;
      }
      if (m.sys === 'welcome' && this.role === 'guest') { this.hostId = m.from; this._joined?.(); return; }
      if (m.sys === 'probe' && this.role === 'host') { this.ch.postMessage({ sys: 'here', from: this.selfId, to: m.from }); return; }
      if (m.sys === 'here') { this._taken?.(); return; }
      if (m.sys === 'bye') {
        if (this.role === 'host' && this.peers.delete(m.from)) this._emit('leave', m.from);
        else if (this.role === 'guest' && m.from === this.hostId) this._emit('close', 'The host closed the room.');
        return;
      }
      if (m.sys) return;
      this._emit('data', m.from, m.msg);
    };
  }

  host(code) {
    this.role = 'host';
    this._open(code);
    return new Promise((resolve, reject) => {
      // make sure nobody else is hosting this code in another tab
      this._taken = () => reject(Object.assign(new Error('Code in use'), { type: 'unavailable-id' }));
      this.ch.postMessage({ sys: 'probe', from: this.selfId });
      setTimeout(() => { this._taken = null; resolve(this.selfId); }, 250);
    });
  }

  join(code) {
    this.role = 'guest';
    this._open(code);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(Object.assign(new Error('Room not found in this browser.'), { type: 'not-found' })), 1500);
      this._joined = () => { clearTimeout(t); resolve(this.selfId); };
      this.ch.postMessage({ sys: 'knock', from: this.selfId });
    });
  }

  send(to, msg) { this.ch?.postMessage({ from: this.selfId, to, msg }); }
  broadcast(msg, except = null) { for (const p of this.peers) if (p !== except) this.send(p, msg); }
  toHost(msg) { this.send(this.hostId, msg); }
  kick(id) { this.send(id, { t: 'kicked' }); this.peers.delete(id); }
  close() {
    this.closed = true;
    try { this.ch?.postMessage({ sys: 'bye', from: this.selfId }); this.ch?.close(); } catch { /* ignore */ }
  }
}
