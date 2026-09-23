// Tiny DOM builder: h('div.card#id', {onclick, style, ...attrs}, ...children)
export function h(tag, props, ...children) {
  let [name, ...rest] = tag.split(/(?=[.#])/);
  const el = document.createElement(name || 'div');
  for (const r of rest) {
    if (r[0] === '.') el.classList.add(r.slice(1));
    else if (r[0] === '#') el.id = r.slice(1);
  }
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'class') el.className += ' ' + v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export const ICONS = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg>',
  users: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="4"/><path d="M1 21c0-4 4-7 8-7s8 3 8 7z"/><circle cx="17" cy="7" r="3"/><path d="M17 12c3 0 6 2.5 6 6h-5"/></svg>',
  car: '<svg viewBox="0 0 24 24"><path d="M3 15l2-6c.4-1.2 1.4-2 2.7-2h8.6c1.3 0 2.3.8 2.7 2l2 6v4h-2.5v-2h-13v2H3z"/><circle cx="7" cy="15" r="1.6" fill="#0003"/><circle cx="17" cy="15" r="1.6" fill="#0003"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path d="M10.3 2h3.4l.5 2.6 2.1.9 2.2-1.5 2.4 2.4-1.5 2.2.9 2.1 2.6.5v3.4l-2.6.5-.9 2.1 1.5 2.2-2.4 2.4-2.2-1.5-2.1.9-.5 2.6h-3.4l-.5-2.6-2.1-.9-2.2 1.5-2.4-2.4 1.5-2.2-.9-2.1L2 13.7v-3.4l2.6-.5.9-2.1-1.5-2.2 2.4-2.4 2.2 1.5 2.1-.9zM12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 4l-8 8 8 8" fill="none" stroke="currentColor" stroke-width="3"/></svg>',
  flag: '<svg viewBox="0 0 24 24"><path d="M5 2v20H3V2zm2 1h13l-3 5 3 5H7z"/></svg>',
  trophy: '<svg viewBox="0 0 24 24"><path d="M6 3h12v2h3v3c0 3-2 5-5 5.5A6 6 0 0113 17v2h4v2H7v-2h4v-2a6 6 0 01-3-3.5C5 13 3 11 3 8V5h3zm0 4H5v1c0 1.6.9 2.8 2.2 3.3C6.4 10 6 8.6 6 7zm12 0c0 1.6-.4 3-1.2 4.3C18.1 10.8 19 9.6 19 8V7z"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><path d="M8 3h11v13H8zM5 7v14h11v-2H7V7z"/></svg>',
  crown: '<svg viewBox="0 0 24 24"><path d="M3 7l5 4 4-7 4 7 5-4-2 11H5z"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" fill="none" stroke="currentColor" stroke-width="3"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 110 20 10 10 0 010-20zm-1 4v7l5 3 1-1.6-4-2.4V6z"/></svg>',
  bolt: '<svg viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
  loop: '<svg viewBox="0 0 24 24"><path d="M12 4a6 6 0 016 6c0 3-2 5-4 6h7v2H3v-2h7c-2-1-4-3-4-6a6 6 0 016-6zm0 2a4 4 0 100 8 4 4 0 000-8z"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1 1.4 1.4 1-1a2 2 0 012.9 2.9l-3 3a2 2 0 01-2.9 0zm4-4a4 4 0 00-5.7 0l-3 3A4 4 0 0011 18.7l1-1-1.4-1.4-1 1a2 2 0 01-2.9-2.9l3-3a2 2 0 012.9 0z"/></svg>',
  robot: '<svg viewBox="0 0 24 24"><path d="M11 2h2v3h5a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h5zM8.5 9a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm7 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM8 14v2h8v-2z"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>',
};

export function icon(name) {
  const s = document.createElement('span');
  s.className = 'ico';
  s.innerHTML = ICONS[name] || '';
  return s;
}
