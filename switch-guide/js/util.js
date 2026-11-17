// Small DOM and UI helpers. All user text goes through textContent, never innerHTML.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const nextFrame = () => new Promise((r) => setTimeout(r, 0));

export function fmtDate(ts) {
  if (!ts) return 'never';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

export function safeFileName(s) {
  return (s || 'Property').replace(/[\\/:*?"<>|#%&{}$!'@+`=\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Property';
}

// Relative luminance check so text on the accent color stays readable.
export function isLight(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2] > 0.45;
}

export function hexToRgb(hex) {
  const n = parseInt((hex || '#000000').replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------- toast ----------
let toastTimer;
export function toast(msg, opts = {}) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(el);
  }
  el.replaceChildren(h('span', null, msg));
  if (opts.action) {
    el.appendChild(h('button', { class: 'toast-action', onclick: () => { el.classList.remove('show'); opts.action.run(); } }, opts.action.label));
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), opts.ms || (opts.action ? 5000 : 2600));
}

// ---------- modal ----------
// modal({title, body (node|string), actions:[{label, kind:'primary'|'danger'|'plain', value, onClick}], dismissable})
// Resolves with the clicked action's value (or null when dismissed).
export function modal({ title, body, actions = [{ label: 'OK', kind: 'primary', value: true }], dismissable = true, className = '' }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const prevFocus = document.activeElement;
    let done = false;
    const close = (v) => {
      if (done) return;
      done = true;
      wrap.classList.remove('show');
      setTimeout(() => wrap.remove(), 180);
      document.removeEventListener('keydown', onKey);
      if (prevFocus && prevFocus.focus && document.contains(prevFocus)) { try { prevFocus.focus({ preventScroll: true }); } catch (e) {} }
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape' && dismissable) close(null); };
    const btns = actions.map((a) =>
      h('button', {
        class: 'btn ' + (a.kind === 'primary' ? 'btn-primary' : a.kind === 'danger' ? 'btn-danger' : 'btn-plain'),
        type: 'button',
        onclick: async (e) => {
          if (a.onClick) {
            const r = await a.onClick(e, close);
            if (r === false) return; // handler keeps the modal open
          }
          close(a.value === undefined ? a.label : a.value);
        },
      }, a.label));
    const dialog = h('div', { class: 'modal ' + className, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' },
      title ? h('h2', { class: 'modal-title' }, title) : null,
      h('div', { class: 'modal-body' }, typeof body === 'string' ? h('p', null, body) : body),
      btns.length ? h('div', { class: 'modal-actions' }, btns) : null);
    const wrap = h('div', { class: 'modal-wrap', onclick: (e) => { if (e.target === wrap && dismissable) close(null); } }, dialog);
    wrap._close = close;
    root.appendChild(wrap);
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => wrap.classList.add('show'));
    const first = dialog.querySelector('input, textarea, select');
    if (first) setTimeout(() => first.focus(), 50);
  });
}

export function confirmDialog(title, message, okLabel = 'OK', danger = false) {
  return modal({
    title, body: message,
    actions: [
      { label: 'Cancel', kind: 'plain', value: false },
      { label: okLabel, kind: danger ? 'danger' : 'primary', value: true },
    ],
  }).then((v) => v === true);
}

export function promptDialog(title, { value = '', placeholder = '', okLabel = 'Save', suggestions = [], maxLength = 200, help } = {}) {
  const input = h('input', { type: 'text', value, placeholder, maxLength, class: 'field', autocomplete: 'off', enterkeyhint: 'done' });
  const chips = suggestions.length
    ? h('div', { class: 'chips wrap' }, suggestions.map((s) => h('button', { type: 'button', class: 'chip', onclick: () => { input.value = s; input.focus(); } }, s)))
    : null;
  let submit;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit && submit(); } });
  const p = modal({
    title,
    body: h('div', null, help ? h('p', { class: 'muted small' }, help) : null, input, chips),
    actions: [
      { label: 'Cancel', kind: 'plain', value: null },
      { label: okLabel, kind: 'primary', onClick: (e, close) => { close(input.value.trim()); return false; } },
    ],
  });
  submit = () => { const w = input.closest('.modal-wrap'); w && w._close(input.value.trim()); };
  return p.then((v) => (v === null || v === undefined ? null : v));
}

// Busy overlay with progress. Returns {set(text, fraction), close()}.
export function busy(text) {
  const label = h('div', { class: 'busy-text' }, text);
  const bar = h('div', { class: 'busy-bar-fill' });
  const el = h('div', { class: 'busy-wrap' }, h('div', { class: 'busy' }, h('div', { class: 'spinner' }), label, h('div', { class: 'busy-bar' }, bar)));
  document.body.appendChild(el);
  return {
    set(t, frac) {
      if (t) label.textContent = t;
      if (typeof frac === 'number') bar.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
    },
    close() { el.remove(); },
  };
}

// Pick a file with a hidden <input type=file>. Must be called from a tap handler.
export function pickFile({ accept = '', capture } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    if (capture) input.capture = capture;
    input.style.position = 'fixed';
    input.style.left = '-1000px';
    let settled = false;
    input.addEventListener('change', () => { settled = true; resolve(input.files && input.files[0] ? input.files[0] : null); input.remove(); });
    input.addEventListener('cancel', () => { if (!settled) { settled = true; resolve(null); } input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}

// Replace an element's children, skipping null/false (replaceChildren would print "null").
export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}
