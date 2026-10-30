// DOM helpers, icons and formatting shared by every view.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of [children].flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

const ICONS = {
  check: '<polyline points="20 6 9 17 4 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  play: '<path d="M7 4.5v15l12-7.5z" class="fillable"/>',
  upload: '<path d="M12 19V6"/><polyline points="6 12 12 6 18 12"/><line x1="5" y1="3" x2="19" y2="3"/>',
  left: '<polyline points="15 18 9 12 15 6"/>',
  first: '<polyline points="17 18 11 12 17 6"/><line x1="7" y1="6" x2="7" y2="18"/>',
  last: '<polyline points="7 18 13 12 7 6"/><line x1="17" y1="6" x2="17" y2="18"/>',
  pause: '<line x1="9" y1="5" x2="9" y2="19"/><line x1="15" y1="5" x2="15" y2="19"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  right: '<polyline points="9 18 15 12 9 6"/>',
  reset: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><polyline points="3 3.5 3.5 8.5 8.5 8"/>',
  sliders: '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="9" cy="7" r="2.4" class="bgfill"/><circle cx="15" cy="17" r="2.4" class="bgfill"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a6.6 6.6 0 0 0 10.7 10.7z"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  terminal: '<rect x="2.5" y="4" width="19" height="16" rx="2.5"/><polyline points="7 9 10 12 7 15"/><line x1="12.5" y1="15" x2="17" y2="15"/>',
  list: '<line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.4 1.1 2.2h5c0-.8.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
  alert: '<path d="M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="16.6" r=".6"/>',
  drop: '<path d="M12 3.2s6 6.6 6 10.8a6 6 0 0 1-12 0c0-4.2 6-10.8 6-10.8z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  search: '<circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16" y2="16"/>',
  shuffle: '<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>',
  folder: '<path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H9l2 2.5h7.5A2.5 2.5 0 0 1 21 9v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  external: '<path d="M14 4h6v6"/><line x1="20" y1="4" x2="11" y2="13"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  bug: '<rect x="7" y="8" width="10" height="12" rx="5"/><path d="M12 8V5M9 5.5 7.5 3.5M15 5.5l1.5-2M3 13h4M17 13h4M4 19l3.2-1.8M20 19l-3.2-1.8M4 7l3.2 1.8M20 7l-3.2 1.8"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><polyline points="3 3.5 3.5 8.5 8.5 8"/><polyline points="12 8 12 12 14.5 13.5"/>',
  flame: '<path d="M12 22a7 7 0 0 0 7-7c0-4-3-6-4-9-1.5 2-2 3.5-2 5-1.5-1-2.5-3-2.5-5C7 8 5 11 5 15a7 7 0 0 0 7 7z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><polyline points="14 3 14 8 19 8"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/>',
  info: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="7.8" r=".6"/>',
};

export function icon(name, cls = '') {
  const wrap = document.createElement('span');
  wrap.innerHTML = `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  const svg = wrap.firstChild;
  for (const el of svg.querySelectorAll('.fillable')) el.setAttribute('fill', 'currentColor');
  for (const el of svg.querySelectorAll('.bgfill')) el.setAttribute('fill', 'var(--bg-elev2)');
  return svg;
}

export function statusIcon(status) {
  const name = status === 'solved' ? 'check' : status === 'attempted' ? 'clock' : 'drop';
  const title = status === 'solved' ? 'Solved' : status === 'attempted' ? 'Attempted' : 'Not started';
  return h('span', { class: `status-icon ${status || 'todo'}`, title }, status === 'todo' || !status ? '' : icon(name));
}

export function diffClass(d) {
  return String(d || '').toLowerCase();
}

export function fmtBytes(n) {
  if (n === null || n === undefined) return '–';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export function fmtMs(ms) {
  if (ms === null || ms === undefined) return '–';
  if (ms < 1) return `${Math.max(0.01, ms).toFixed(2)} ms`;
  if (ms < 100) return `${ms.toFixed(1)} ms`;
  return `${Math.round(ms)} ms`;
}

export function timeAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString();
}

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function toast(message, kind = '') {
  const el = h('div', { class: `toast ${kind}` }, message);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), 3200);
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Makes `gutter` resize `target` by dragging. axis 'x' changes width, 'y' height.
export function makeResizable(gutter, target, { axis, min = 160, max = () => Infinity, invert = false, key }) {
  const saved = key && localStorageGet(key);
  if (saved) target.style[axis === 'x' ? 'width' : 'height'] = saved;
  gutter.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const start = axis === 'x' ? e.clientX : e.clientY;
    const rect = target.getBoundingClientRect();
    const startSize = axis === 'x' ? rect.width : rect.height;
    gutter.classList.add('dragging');
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
    const move = (ev) => {
      const delta = (axis === 'x' ? ev.clientX : ev.clientY) - start;
      const size = Math.max(min, Math.min(max(), startSize + (invert ? -delta : delta)));
      target.style[axis === 'x' ? 'width' : 'height'] = `${size}px`;
    };
    const up = () => {
      gutter.classList.remove('dragging');
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (key) localStorageSet(key, target.style[axis === 'x' ? 'width' : 'height']);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

export function localStorageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function localStorageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

export function confirmDialog(title, message, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    const close = (v) => { backdrop.remove(); resolve(v); };
    const backdrop = h('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) close(false); } },
      h('div', { class: 'modal', style: { width: 'min(440px, calc(100vw - 40px))' } },
        h('div', { class: 'modal-head' }, h('h2', null, title)),
        h('div', { class: 'modal-body' },
          h('p', { style: { color: 'var(--text-dim)', margin: '12px 0 18px' } }, message),
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px' } },
            h('button', { class: 'btn ghost', onclick: () => close(false) }, 'Cancel'),
            h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => close(true) }, okLabel)))));
    document.body.append(backdrop);
  });
}

export function celebrate() {
  const colors = ['#8b9bff', '#3ccf91', '#f5b83d', '#f4707a', '#5fb3f9'];
  const layer = h('div', { class: 'celebrate' });
  for (let i = 0; i < 70; i++) {
    layer.append(h('i', {
      style: {
        left: `${Math.random() * 100}%`,
        background: colors[i % colors.length],
        animationDelay: `${Math.random() * 0.5}s`,
        animationDuration: `${1.2 + Math.random() * 1}s`,
      },
    }));
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 2600);
}
