// Switch Guide — screens, routing, exports and app updates.
import { APP_NAME, APP_VERSION, CREDIT, DISCLAIMER, ROOM_SUGGESTIONS, ACCENT_PRESETS, DEFAULT_ACCENT } from './config.js';
import * as db from './db.js';
import { h, uid, toast, modal, confirmDialog, promptDialog, busy, pickFile, fmtDate, fmtBytes, isLight, safeFileName } from './util.js';
import { fill } from './util.js';
import { processPhoto, urlFor, revokeScreenUrls } from './images.js';
import { makeSortable } from './sortable.js';
import { renderEditor } from './editor.js';
import { topbar, navigate, addBankFlow, bankTitle, showError, savePhoto, requestPersist } from './actions.js';
import { scanTree } from './secrets.js';
import { offerFile } from './share.js';

const app = document.getElementById('app');
let profile = null;

// ---------- theme ----------
function applyTheme() {
  const accent = (profile && profile.accent) || DEFAULT_ACCENT;
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--on-accent', isLight(accent) ? '#1e1e20' : '#ffffff');
}

// ---------- router ----------
const routes = [
  [/^#?\/?$/, () => renderHome()],
  [/^#\/p\/([\w-]+)$/, (m) => renderProperty(m[1])],
  [/^#\/b\/([\w-]+)$/, (m) => renderEditor(app, m[1])],
  [/^#\/profile$/, () => renderProfile(false)],
  [/^#\/about$/, () => renderAbout()],
];

let routing = Promise.resolve();
function route() {
  routing = routing.then(async () => {
    if (app._cleanup) { try { app._cleanup(); } catch (e) {} app._cleanup = null; }
    revokeScreenUrls();
    profile = (await db.kvGet('profile')) || null;
    applyTheme();
    const hash = location.hash || '#/';
    if (!profile && hash !== '#/about') { await renderProfile(true); return; }
    for (const [re, fn] of routes) {
      const m = hash.match(re);
      if (m) { await fn(m); window.scrollTo(0, 0); return; }
    }
    navigate('#/');
  }).catch((e) => showError('Something went wrong', e));
}
window.addEventListener('hashchange', route);

// ---------- home: list of properties ----------
function isIOS() { return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
function isStandalone() { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

async function renderHome() {
  const props = (await db.getAll('properties')).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const [banks, switches] = await Promise.all([db.getAll('banks'), db.getAll('switches')]);
  const count = (arr, pid) => arr.reduce((n, x) => n + (x.propertyId === pid ? 1 : 0), 0);

  const cards = await Promise.all(props.map(async (p) => {
    const thumb = p.heroPhotoId ? await db.get('thumbs', p.heroPhotoId) : null;
    const nsw = count(switches, p.id), nb = count(banks, p.id);
    const needsBackup = nsw > 0 && (p.updatedAt || 0) > (p.lastBackupAt || 0);
    return h('a', { class: 'prop-card', href: '#/p/' + p.id },
      thumb ? h('img', { class: 'prop-thumb', src: urlFor(thumb), alt: '' }) : h('div', { class: 'prop-thumb placeholder' }, '⌂'),
      h('div', { class: 'prop-info' },
        h('div', { class: 'prop-addr' }, p.address),
        p.cityLine ? h('div', { class: 'prop-city' }, p.cityLine) : null,
        h('div', { class: 'prop-meta' }, `${nb} ${nb === 1 ? 'bank' : 'banks'} · ${nsw} ${nsw === 1 ? 'switch' : 'switches'}`),
        needsBackup ? h('div', { class: 'badge warn' }, 'Not backed up') : null));
  }));

  const installTip = isIOS() && !isStandalone() && !lsGet('sg-hide-install')
    ? h('div', { class: 'card tip' },
      h('strong', null, 'Install before you start'),
      h('p', null, 'Tap the Share button, then “Add to Home Screen.” Open Switch Guide from that icon from now on: it works with no signal, and it keeps its own copy of your properties (separate from this Safari tab).'),
      h('button', { class: 'btn btn-plain btn-small', onclick: (e) => { lsSet('sg-hide-install', '1'); e.target.closest('.tip').remove(); } }, 'Got it'))
    : null;

  fill(app, 
    topbar({ title: APP_NAME, right: h('a', { class: 'icon-btn avatar', href: '#/about', 'aria-label': 'About and settings' }, 'i') }),
    h('main', { class: 'home' },
      installTip,
      props.length ? h('div', { class: 'prop-list' }, cards)
        : h('div', { class: 'empty' },
          h('h2', { class: 'serif' }, 'Your listings'),
          h('p', null, 'Create a property, then walk the house room by room, photographing each bank of switches and tapping each switch to say what it controls.')),
      h('div', { class: 'stack' },
        h('button', { class: 'btn btn-primary full', onclick: newProperty }, '+ New property'),
        h('button', { class: 'btn btn-plain full', onclick: importFlow }, 'Import a backup file')),
      h('nav', { class: 'home-links' },
        h('a', { href: '#/profile' }, 'My profile & branding'), ' · ',
        h('a', { href: 'how-to.html' }, 'How to use it'), ' · ',
        h('a', { href: '#/about' }, 'About'))));
}

async function newProperty() {
  const addr = h('input', { class: 'field', type: 'text', placeholder: 'Street address, e.g. 1200 S Ocean Blvd', maxLength: 300, autocomplete: 'off' });
  const city = h('input', { class: 'field', type: 'text', placeholder: 'City, State (optional)', maxLength: 300, autocomplete: 'off' });
  const v = await modal({
    title: 'New property',
    body: h('div', { class: 'form' }, addr, city),
    actions: [
      { label: 'Cancel', kind: 'plain', value: null },
      { label: 'Create', kind: 'primary', onClick: (e, close) => { if (!addr.value.trim()) { addr.focus(); toast('Enter the address.'); return false; } close({ a: addr.value.trim(), c: city.value.trim() }); return false; } },
    ],
  });
  if (!v) return;
  const now = Date.now();
  const p = { id: uid(), address: v.a, cityLine: v.c, heroPhotoId: null, guideUrl: '', createdAt: now, updatedAt: now, lastBackupAt: 0, extras: {} };
  await db.put('properties', p);
  requestPersist();
  navigate('#/p/' + p.id);
}

async function importFlow() {
  const file = await pickFile({}); // no type filter: iPhone greys out unfamiliar file types otherwise
  if (!file) return;
  const { readBackup, importBackup } = await import('./backup.js');
  await loadFflate();
  const b = busy('Reading backup…');
  try {
    const parsed = await readBackup(file);
    b.close();
    const existing = parsed.data.property.id ? await db.get('properties', parsed.data.property.id) : null;
    let mode = 'new';
    if (existing) {
      mode = await modal({
        title: 'This property is already here',
        body: `“${existing.address}” already exists on this device (last changed ${fmtDate(existing.updatedAt)}). Replace it with the backup, or keep both?`,
        actions: [
          { label: 'Cancel', kind: 'plain', value: null },
          { label: 'Keep both', kind: 'plain', value: 'copy' },
          { label: 'Replace', kind: 'danger', value: 'replace' },
        ],
      });
      if (!mode) return;
    }
    const b2 = busy('Importing photos…');
    try {
      const r = await importBackup(parsed, mode, (f) => b2.set(`Importing… ${Math.round(f * 100)}%`, f));
      b2.close();
      requestPersist();
      toast(r.adoptedProfile ? 'Imported, including the profile in the file.' : 'Imported.');
      navigate('#/p/' + r.propertyId);
    } catch (e) { b2.close(); throw e; }
  } catch (e) {
    b.close();
    showError("Couldn't import that file", e);
  }
}

function loadFflate() {
  if (window.fflate) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'vendor/fflate.min.js'; s.onload = res; s.onerror = () => rej(new Error('Could not load the backup tools.'));
    document.head.appendChild(s);
  });
}

// ---------- property ----------
function expandedKey(pid) { return 'sg-open-' + pid; }
function getExpanded(pid) { try { return new Set(JSON.parse(sessionStorage.getItem(expandedKey(pid)) || 'null') || []); } catch (e) { return new Set(); } }
function setExpanded(pid, set) { try { sessionStorage.setItem(expandedKey(pid), JSON.stringify([...set])); } catch (e) {} }

async function renderProperty(pid) {
  const tree = await db.loadPropertyTree(pid);
  if (!tree) { navigate('#/'); return; }
  const { property: p, rooms } = tree;
  const nsw = tree.switches.length;
  let expanded = getExpanded(pid);
  if (!sessionStorage.getItem(expandedKey(pid))) {
    expanded = new Set(rooms.length <= 5 ? rooms.map((r) => r.id) : []);
    setExpanded(pid, expanded);
  }

  const hero = p.heroPhotoId ? await db.get('photos', p.heroPhotoId) : null;
  const thumbs = new Map();
  await Promise.all(tree.banks.map(async (b) => { if (b.photoId) thumbs.set(b.id, await db.get('thumbs', b.photoId)); }));

  const needsBackup = nsw > 0 && (p.updatedAt || 0) > (p.lastBackupAt || 0);

  const roomList = h('ol', { class: 'rooms' }, rooms.map((room) => {
    const open = expanded.has(room.id);
    const ns = room.banks.reduce((n, b) => n + b.switches.length, 0);
    const bankList = h('ol', { class: 'banks' }, room.banks.map((b, bi) => h('li', { class: 'bank', dataset: { id: b.id } },
      h('span', { class: 'handle bank-handle', 'aria-label': 'Drag to reorder', role: 'button' }, '≡'),
      h('a', { class: 'bank-link', href: '#/b/' + b.id },
        thumbs.get(b.id) ? h('img', { class: 'bank-thumb', src: urlFor(thumbs.get(b.id)), alt: '' }) : h('span', { class: 'bank-thumb placeholder' }),
        h('span', { class: 'bank-text' },
          h('span', { class: 'bank-name' }, bankTitle(b, bi, room.banks.length)),
          h('span', { class: 'bank-meta' }, `${b.switches.length} ${b.switches.length === 1 ? 'switch' : 'switches'}` + (b.switches.some((s) => s.showing) ? ` · ${b.switches.filter((s) => s.showing).length} for showings` : ''))),
        h('span', { class: 'chev' }, '›')))));
    makeSortable(bankList, {
      item: '.bank', handle: '.bank-handle',
      onEnd: async (ids) => {
        await db.batch(ids.map((id, i) => { const b = room.banks.find((x) => x.id === id); b.order = i; return { store: 'banks', value: stripBank(b) }; }));
        await db.touchProperty(pid);
      },
    });
    const li = h('li', { class: 'room' + (open ? ' open' : ''), dataset: { id: room.id } },
      h('div', { class: 'room-head' },
        h('span', { class: 'handle room-handle', 'aria-label': 'Drag to reorder room', role: 'button' }, '≡'),
        h('button', { class: 'room-toggle', type: 'button', 'aria-expanded': open ? 'true' : 'false', onclick: () => {
          if (expanded.has(room.id)) expanded.delete(room.id); else expanded.add(room.id);
          setExpanded(pid, expanded);
          li.classList.toggle('open');
        } },
          h('span', { class: 'room-name' }, room.name),
          h('span', { class: 'room-meta' }, `${room.banks.length} ${room.banks.length === 1 ? 'bank' : 'banks'} · ${ns}`)),
        h('button', { class: 'icon-btn', 'aria-label': 'Room options', onclick: () => roomMenu(room, tree) }, '•••')),
      h('div', { class: 'room-body' },
        bankList,
        h('button', { class: 'btn btn-plain full add-bank', onclick: () => addBankFlow(room) }, '+ Add switch bank (photo)')));
    return li;
  }));
  makeSortable(roomList, {
    item: '.room', handle: '.room-handle',
    onEnd: async (ids) => {
      await db.batch(ids.map((id, i) => { const r = rooms.find((x) => x.id === id); r.order = i; return { store: 'rooms', value: stripRoom(r) }; }));
      await db.touchProperty(pid);
      toast('Walking order saved.');
    },
  });

  const menuBtn = h('button', { class: 'icon-btn', 'aria-label': 'Property options', onclick: () => propertyMenu(p) }, '•••');
  let heroPick = null;
  const heroEl = hero
    ? h('img', { class: 'hero', src: urlFor(hero), alt: 'Cover photo' })
    : h('button', { class: 'hero-empty', type: 'button', onclick: () => { heroPick = pickFile({ accept: 'image/*' }); setHero(p, heroPick); } }, '+ Add a cover photo (optional)');

  fill(app, 
    topbar({ back: '#/', title: p.address, right: menuBtn }),
    h('main', { class: 'property' },
      heroEl,
      h('h1', { class: 'serif prop-title' }, p.address),
      p.cityLine ? h('p', { class: 'prop-city' }, p.cityLine) : null,
      needsBackup ? h('div', { class: 'card warn-card' },
        h('div', null, h('strong', null, 'Not backed up. '), p.lastBackupAt ? `Changed since your last backup (${fmtDate(p.lastBackupAt)}).` : 'This property has never been saved to a file.'),
        h('button', { class: 'btn btn-small btn-primary', onclick: () => backupFlow(p.id) }, 'Back up now')) : null,
      h('div', { class: 'section-head' },
        h('h2', null, 'Rooms'),
        rooms.length > 1 ? h('span', { class: 'muted small' }, 'Drag ≡ into walking order') : null),
      rooms.length ? roomList : h('p', { class: 'muted' }, 'Add the first room you walk into, usually the foyer.'),
      h('button', { class: 'btn btn-plain full', onclick: () => addRoom(tree) }, '+ Add room'),
      h('div', { class: 'section-head' }, h('h2', null, 'Share & export')),
      h('p', { class: 'muted small' }, `${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'} · ${tree.banks.length} switch banks · ${nsw} switches · ${tree.switches.filter((s) => s.showing).length} for showings`),
      h('div', { class: 'export-grid' },
        exportBtn('Home Guide', 'PDF closing gift', () => exportPdf('guide', pid)),
        exportBtn('Showing Sheet', 'PDF, lights in walking order', () => exportPdf('showing', pid)),
        exportBtn('QR card', 'Printable link to the guide', () => qrFlow(pid)),
        exportBtn('Back up', 'Save this property as a file', () => backupFlow(pid))),
      h('p', { class: 'muted small center' }, 'Last backup: ' + fmtDate(p.lastBackupAt))));

  // bump the hero picker
  if (hero) {
    app.querySelector('.hero').addEventListener('click', () => {
      const pick = pickFile({ accept: 'image/*' });
      setHero(p, pick);
    });
  }
}

function stripRoom(r) { return { id: r.id, propertyId: r.propertyId, name: r.name, order: r.order }; }
function stripBank(b) { return { id: b.id, propertyId: b.propertyId, roomId: b.roomId, location: b.location, photoId: b.photoId, order: b.order }; }

function exportBtn(title, sub, fn) {
  return h('button', { class: 'export-btn', type: 'button', onclick: fn }, h('span', { class: 'eb-title' }, title), h('span', { class: 'eb-sub' }, sub));
}

async function setHero(p, filePromise) {
  const file = await filePromise;
  if (!file) return;
  const b = busy('Preparing photo…');
  try {
    const old = p.heroPhotoId;
    p.heroPhotoId = await savePhoto(file, p.id);
    p.updatedAt = Date.now();
    await db.put('properties', p);
    if (old) await db.batch([{ store: 'photos', del: old }, { store: 'thumbs', del: old }]);
    b.close();
    route();
  } catch (e) { b.close(); showError("Couldn't use that photo", e); }
}

async function addRoom(tree) {
  const used = new Set(tree.rooms.map((r) => r.name.toLowerCase()));
  const name = await promptDialog('Add room', { placeholder: 'Room name', okLabel: 'Add', suggestions: ROOM_SUGGESTIONS.filter((s) => !used.has(s.toLowerCase())).slice(0, 18) });
  if (!name) return;
  const room = { id: uid(), propertyId: tree.property.id, name: name.slice(0, 200), order: tree.rooms.reduce((m, r) => Math.max(m, r.order + 1), 0) };
  await db.put('rooms', room);
  await db.touchProperty(tree.property.id);
  const ex = getExpanded(tree.property.id); ex.add(room.id); setExpanded(tree.property.id, ex);
  route();
}

async function roomMenu(room, tree) {
  const idx = tree.rooms.indexOf(room);
  const choice = await modal({
    title: room.name, body: '', className: 'menu',
    actions: [
      { label: 'Rename room', kind: 'plain', value: 'rename' },
      idx > 0 ? { label: 'Move up', kind: 'plain', value: 'up' } : null,
      idx < tree.rooms.length - 1 ? { label: 'Move down', kind: 'plain', value: 'down' } : null,
      { label: 'Delete room', kind: 'danger', value: 'delete' },
      { label: 'Cancel', kind: 'plain', value: null },
    ].filter(Boolean),
  });
  const pid = tree.property.id;
  if (choice === 'rename') {
    const v = await promptDialog('Rename room', { value: room.name });
    if (v) { room.name = v.slice(0, 200); await db.put('rooms', stripRoom(room)); await db.touchProperty(pid); route(); }
  } else if (choice === 'up' || choice === 'down') {
    const arr = [...tree.rooms];
    const j = choice === 'up' ? idx - 1 : idx + 1;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    await db.batch(arr.map((r, i) => { r.order = i; return { store: 'rooms', value: stripRoom(r) }; }));
    await db.touchProperty(pid); route();
  } else if (choice === 'delete') {
    const n = room.banks.length, ns = room.banks.reduce((k, b) => k + b.switches.length, 0);
    const ok = await confirmDialog(`Delete ${room.name}?`, n ? `This deletes ${n} switch ${n === 1 ? 'bank' : 'banks'} and ${ns} switches in this room. There is no copy anywhere else, so this can't be undone.` : 'This room is empty.', 'Delete', true);
    if (!ok) return;
    for (const b of room.banks) await db.deleteBankDeep(b);
    await db.del('rooms', room.id);
    await db.touchProperty(pid);
    toast('Room deleted.');
    route();
  }
}

async function propertyMenu(p) {
  let heroPick = null;
  const choice = await modal({
    title: p.address, body: '', className: 'menu',
    actions: [
      { label: 'Edit address', kind: 'plain', value: 'edit' },
      { label: p.heroPhotoId ? 'Change cover photo' : 'Add cover photo', kind: 'plain', value: 'hero', onClick: () => { heroPick = pickFile({ accept: 'image/*' }); } },
      p.heroPhotoId ? { label: 'Remove cover photo', kind: 'plain', value: 'nohero' } : null,
      { label: 'Delete property', kind: 'danger', value: 'delete' },
      { label: 'Cancel', kind: 'plain', value: null },
    ].filter(Boolean),
  });
  if (choice === 'edit') {
    const addr = h('input', { class: 'field', type: 'text', value: p.address, maxLength: 300 });
    const city = h('input', { class: 'field', type: 'text', value: p.cityLine || '', placeholder: 'City, State (optional)', maxLength: 300 });
    const v = await modal({ title: 'Edit address', body: h('div', { class: 'form' }, addr, city), actions: [{ label: 'Cancel', kind: 'plain', value: null }, { label: 'Save', kind: 'primary', value: 'save' }] });
    if (v === 'save' && addr.value.trim()) { p.address = addr.value.trim(); p.cityLine = city.value.trim(); p.updatedAt = Date.now(); await db.put('properties', p); route(); }
  } else if (choice === 'hero') {
    setHero(p, heroPick);
  } else if (choice === 'nohero') {
    const old = p.heroPhotoId; p.heroPhotoId = null; p.updatedAt = Date.now();
    await db.put('properties', p); await db.batch([{ store: 'photos', del: old }, { store: 'thumbs', del: old }]); route();
  } else if (choice === 'delete') {
    const typed = h('input', { class: 'field', type: 'text', placeholder: 'Type DELETE', autocapitalize: 'characters', autocomplete: 'off' });
    const needsBackup = (p.updatedAt || 0) > (p.lastBackupAt || 0);
    const v = await modal({
      title: 'Delete this property?',
      body: h('div', null,
        h('p', null, `“${p.address}” and all its photos will be erased from this device. There is no copy on any server.`),
        needsBackup ? h('p', { class: 'warn-text' }, 'It has changes that are not in a backup file.') : null,
        h('p', { class: 'small muted' }, 'Type DELETE to confirm.'), typed),
      actions: [
        { label: 'Cancel', kind: 'plain', value: null },
        { label: 'Delete forever', kind: 'danger', onClick: (e, close) => { if (typed.value.trim().toUpperCase() !== 'DELETE') { toast('Type DELETE to confirm.'); return false; } close('yes'); return false; } },
      ],
    });
    if (v === 'yes') { await db.deletePropertyDeep(p.id); toast('Property deleted.'); navigate('#/'); }
  }
}

// ---------- exports ----------
async function preflight(tree, kind) {
  const hits = scanTree(tree);
  if (hits.length) {
    const list = h('ul', { class: 'hit-list' }, hits.slice(0, 12).map((x) => h('li', null, h('strong', null, x.where), h('br'), `“${x.text}”`, h('span', { class: 'muted' }, ` (${x.reason})`))));
    const v = await modal({
      title: 'Possible code or password',
      body: h('div', null,
        h('p', null, 'This guide may be printed and left in the house. It should never include alarm, gate, garage, or door codes, or Wi-Fi passwords. Please check:'),
        list, hits.length > 12 ? h('p', { class: 'muted small' }, `…and ${hits.length - 12} more.`) : null),
      actions: [{ label: 'Go back and fix', kind: 'primary', value: false }, { label: 'It’s fine, export anyway', kind: 'plain', value: true }],
    });
    if (v !== true) return false;
  }
  if (kind === 'guide') {
    const unlabeled = tree.switches.filter((s) => !s.label).length;
    if (unlabeled) {
      const ok = await confirmDialog('Some switches have no label', `${unlabeled} ${unlabeled === 1 ? 'switch has' : 'switches have'} no label yet and will show as “No label yet.”`, 'Export anyway');
      if (!ok) return false;
    }
  }
  return true;
}

async function exportPdf(kind, pid) {
  const tree = await db.loadPropertyTree(pid);
  if (!tree.banks.length) { toast('Add a room and a switch bank first.'); return; }
  if (!(await preflight(tree, kind))) return;
  const label = kind === 'guide' ? 'Home Guide' : 'Showing Sheet';
  const b = busy(`Building ${label}…`);
  try {
    const pdf = await import('./pdf.js');
    const fn = kind === 'guide' ? pdf.buildHomeGuide : pdf.buildShowingSheet;
    const t0 = performance.now();
    const { blob, pages } = await fn(tree, profile, (f) => b.set(`Building ${label}… ${Math.round(f * 100)}%`, f));
    b.close();
    window.__lastPdf = { kind, pages, size: blob.size, ms: Math.round(performance.now() - t0) }; // read by automated tests
    await offerFile(blob, `${safeFileName(tree.property.address)} - ${label}.pdf`, {
      title: `${label} ready`,
      note: `${pages} ${pages === 1 ? 'page' : 'pages'}, US Letter. ` + (kind === 'guide' ? 'Save it to Files, or send it to your client.' : 'Print it or keep it on your phone for showings.'),
    });
  } catch (e) {
    b.close();
    showError(`Couldn't build the ${label}`, e);
  }
}

async function qrFlow(pid) {
  const p = await db.get('properties', pid);
  const pdf = await import('./pdf.js');
  const input = h('input', { class: 'field', type: 'url', value: p.guideUrl || '', placeholder: 'https://drive.google.com/…', autocomplete: 'off', autocapitalize: 'off', spellcheck: false });
  const preview = h('div', { class: 'qr-preview' });
  const status = h('p', { class: 'small muted' });
  let timer;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const url = pdf.normalizeUrl(input.value);
      if (!url) { preview.replaceChildren(); status.textContent = input.value.trim() ? 'That doesn’t look like a web link yet.' : ''; return; }
      try {
        const qr = await pdf.qrMatrix(url);
        preview.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); // library output: rects only
        status.textContent = 'Test it: scan this with another phone before printing.';
      } catch (e) { status.textContent = 'That link is too long for a QR code.'; preview.replaceChildren(); }
    }, 200);
  };
  input.addEventListener('input', refresh);
  refresh();
  const v = await modal({
    title: 'QR card',
    body: h('div', null,
      h('p', { class: 'small' }, 'Upload the Home Guide PDF to Google Drive, Dropbox, or your website and set it so anyone with the link can view it. Paste that link here.'),
      input, preview, status),
    actions: [
      { label: 'Cancel', kind: 'plain', value: null },
      { label: 'Make QR card', kind: 'primary', onClick: (e, close) => { const u = pdf.normalizeUrl(input.value); if (!u) { toast('Paste the link to your guide first.'); return false; } close(u); return false; } },
    ],
  });
  if (!v) return;
  p.guideUrl = v; p.updatedAt = Date.now();
  await db.put('properties', p);
  const b = busy('Building QR card…');
  try {
    const tree = await db.loadPropertyTree(pid);
    const { blob } = await pdf.buildQrCard(tree, profile, v);
    b.close();
    window.__lastPdf = { kind: 'qr', pages: 1, size: blob.size };
    await offerFile(blob, `${safeFileName(p.address)} - QR card.pdf`, { title: 'QR card ready', note: 'Two cards on one page. Print at actual size and cut along the dashed lines.' });
    route();
  } catch (e) { b.close(); showError("Couldn't build the QR card", e); }
}

async function backupFlow(pid) {
  await loadFflate();
  const { exportProperty } = await import('./backup.js');
  const b = busy('Packing photos…');
  try {
    const { blob, filename } = await exportProperty(pid, (f) => b.set(`Packing photos… ${Math.round(f * 100)}%`, f));
    b.close();
    const outcome = await offerFile(blob, filename, {
      title: 'Backup file ready',
      note: 'Save it to Files, iCloud Drive, Google Drive, or email it to yourself. To restore or move it to another device, use “Import a backup file.”',
    });
    if (outcome) {
      const p = await db.get('properties', pid);
      p.lastBackupAt = Date.now();
      await db.put('properties', p);
      toast('Backed up.');
      route();
    }
  } catch (e) { b.close(); showError("Couldn't make the backup", e); }
}

// ---------- profile ----------
async function renderProfile(firstRun) {
  const pr = { name: '', brokerage: '', license: '', phone: '', email: '', accent: DEFAULT_ACCENT, headshot: null, logo: null, ...(profile || {}) };
  const field = (key, label, attrs = {}) => {
    const inp = h('input', { class: 'field', type: 'text', value: pr[key] || '', maxLength: 200, ...attrs });
    inp.addEventListener('input', () => { pr[key] = inp.value; renderPreview(); });
    return h('label', { class: 'lbl' }, h('span', null, label), inp);
  };
  const preview = h('div', { class: 'brand-preview' });
  const imgSlot = (key, label, opts) => {
    const box = h('div', { class: 'img-slot' });
    const draw = () => {
      fill(box, 
        pr[key] ? h('img', { src: urlFor(pr[key]), alt: label, class: key }) : h('span', { class: 'muted small' }, 'None'),
        h('button', { class: 'btn btn-plain btn-small', type: 'button', onclick: async () => {
          const file = await pickFile({ accept: 'image/*' });
          if (!file) return;
          try {
            const { full } = await processPhoto(file, opts);
            pr[key] = full; draw(); renderPreview();
          } catch (e) { showError("Couldn't use that image", e); }
        } }, pr[key] ? 'Change' : 'Add'),
        pr[key] ? h('button', { class: 'btn btn-plain btn-small', type: 'button', onclick: () => { pr[key] = null; draw(); renderPreview(); } }, 'Remove') : null);
    };
    draw();
    return h('div', { class: 'lbl' }, h('span', null, label), box);
  };
  const color = h('input', { type: 'color', value: pr.accent, 'aria-label': 'Custom accent color' });
  const swatches = h('div', { class: 'swatches' });
  const drawSwatches = () => fill(swatches, ...ACCENT_PRESETS.map((c) => h('button', {
    class: 'swatch' + (c.toLowerCase() === (pr.accent || '').toLowerCase() ? ' on' : ''), type: 'button', style: { background: c }, 'aria-label': 'Accent ' + c,
    onclick: () => { pr.accent = c; color.value = c; drawSwatches(); renderPreview(); },
  })), color);
  color.addEventListener('input', () => { pr.accent = color.value; drawSwatches(); renderPreview(); });
  drawSwatches();

  function renderPreview() {
    document.documentElement.style.setProperty('--accent', pr.accent);
    document.documentElement.style.setProperty('--on-accent', isLight(pr.accent) ? '#1e1e20' : '#ffffff');
    fill(preview, 
      h('div', { class: 'bp-over', style: { color: pr.accent } }, 'HOME LIGHTING GUIDE'),
      h('div', { class: 'bp-addr serif' }, '123 Example Way'),
      h('div', { class: 'bp-agent' },
        pr.headshot ? h('img', { class: 'bp-head', src: urlFor(pr.headshot), alt: '' }) : null,
        h('div', { class: 'bp-text' },
          h('strong', null, pr.name || 'Your name'),
          h('span', null, [pr.brokerage, pr.license ? 'Lic. ' + pr.license : ''].filter(Boolean).join(' · ') || 'Brokerage'),
          h('span', null, [pr.phone, pr.email].filter(Boolean).join(' · '))),
        pr.logo ? h('img', { class: 'bp-logo', src: urlFor(pr.logo), alt: '' }) : null));
  }
  renderPreview();

  const save = async () => {
    if (!pr.name.trim()) { toast('Add your name first.'); return; }
    const clean = {};
    for (const k of ['name', 'brokerage', 'license', 'phone', 'email']) clean[k] = (pr[k] || '').trim().slice(0, 200);
    clean.accent = /^#[0-9a-f]{6}$/i.test(pr.accent) ? pr.accent : DEFAULT_ACCENT;
    clean.headshot = pr.headshot; clean.logo = pr.logo;
    await db.kvSet('profile', clean);
    requestPersist();
    toast('Profile saved.');
    navigate('#/');
    if (!firstRun) route();
  };

  fill(app, 
    topbar({ back: firstRun ? null : '#/', title: firstRun ? 'Welcome' : 'My profile' }),
    h('main', { class: 'profile' },
      firstRun ? h('div', { class: 'intro' },
        h('h1', { class: 'serif' }, 'Switch Guide'),
        h('p', null, 'Document which switch controls what in your listings, then hand over a polished guide with your branding.'),
        h('p', { class: 'muted small' }, 'Set up your profile once. It appears on every guide. Everything stays on this device: no account, no sign-in.')) : null,
      field('name', 'Your name', { autocomplete: 'name' }),
      field('brokerage', 'Brokerage', { autocomplete: 'organization' }),
      field('license', 'License number'),
      field('phone', 'Phone', { type: 'tel', autocomplete: 'tel' }),
      field('email', 'Email', { type: 'email', autocomplete: 'email', autocapitalize: 'off' }),
      imgSlot('headshot', 'Headshot', { max: 800, thumbMax: 200 }),
      imgSlot('logo', 'Logo (a PNG with a transparent background looks best)', { max: 1000, thumbMax: 300, keepAlpha: true }),
      h('div', { class: 'lbl' }, h('span', null, 'Accent color'), swatches),
      h('div', { class: 'lbl' }, h('span', null, 'Preview'), preview),
      h('button', { class: 'btn btn-primary full', onclick: save }, firstRun ? 'Save and start' : 'Save profile'),
      firstRun ? h('button', { class: 'btn btn-plain full', onclick: importFlow }, 'I have a backup file') : null));
}

// ---------- about ----------
async function renderAbout() {
  let storage = 'Unknown';
  let persisted = null;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      storage = `${fmtBytes(est.usage || 0)} used`;
    }
    if (navigator.storage && navigator.storage.persisted) persisted = await navigator.storage.persisted();
  } catch (e) {}
  const versionEl = h('span', { class: 'version' }, 'Version ' + APP_VERSION);
  fill(app, 
    topbar({ back: '#/', title: 'About' }),
    h('main', { class: 'about' },
      h('h1', { class: 'serif' }, APP_NAME),
      versionEl,
      h('button', { class: 'btn btn-plain btn-small', onclick: checkForUpdate }, 'Check for updates'),
      h('div', { class: 'card' },
        h('h3', null, 'Your data stays on this device'),
        h('p', null, 'Properties and photos are stored only in this app on this device. There is no account, no server copy, and no tracking. Use “Back up” on each property to save a file you can keep or move to another device.'),
        h('p', { class: 'small muted' }, `Storage: ${storage}. ` + (persisted === true ? 'Protected from automatic clean-up.' : persisted === false ? 'The browser may clear it if the device runs low on space, so back up often.' : '')),
        persisted === false ? h('button', { class: 'btn btn-plain btn-small', onclick: async () => { await requestPersist(); route(); } }, 'Ask the browser to keep my data') : null),
      h('div', { class: 'card' },
        h('h3', null, 'Please note'),
        h('p', null, DISCLAIMER),
        h('p', { class: 'small muted' }, 'Never put alarm, gate, garage, or door codes or Wi-Fi passwords in a guide. The app warns you if something looks like one.')),
      h('p', null, h('a', { href: 'how-to.html' }, 'How to use Switch Guide')),
      h('p', null, h('a', { href: '#/profile' }, 'Edit my profile & branding')),
      h('p', { class: 'credit' }, h('a', { href: CREDIT.url, target: '_blank', rel: 'noopener' }, CREDIT.text)),
      h('p', { class: 'small muted' }, 'Built with jsPDF, fflate, qrcode-generator (MIT) and the Inter and Cormorant Garamond typefaces (SIL Open Font License).'),
      h('button', { class: 'btn btn-danger-text', onclick: eraseAll }, 'Erase everything on this device')));
}

async function eraseAll() {
  const typed = h('input', { class: 'field', type: 'text', placeholder: 'Type ERASE', autocapitalize: 'characters', autocomplete: 'off' });
  const v = await modal({
    title: 'Erase everything?',
    body: h('div', null, h('p', null, 'All properties, photos, and your profile will be removed from this device. Back up any property you want to keep first.'), typed),
    actions: [{ label: 'Cancel', kind: 'plain', value: null }, { label: 'Erase', kind: 'danger', onClick: (e, close) => { if (typed.value.trim().toUpperCase() !== 'ERASE') { toast('Type ERASE to confirm.'); return false; } close('yes'); return false; } }],
  });
  if (v !== 'yes') return;
  await db.wipeAll();
  location.hash = '#/';
  location.reload();
}

// ---------- app updates ----------
let swReg = null;
let updating = false;

function showUpdateBanner(worker) {
  if (document.getElementById('update-banner')) return;
  const ver = h('span', null, 'Update available');
  const banner = h('div', { id: 'update-banner', role: 'alert' }, ver,
    h('button', { class: 'btn btn-small', onclick: () => {
      updating = true;
      // Save anything being typed (the editor's cleanup does this), then switch versions.
      if (app._cleanup) { try { app._cleanup(); } catch (e) {} app._cleanup = null; }
      setTimeout(() => worker.postMessage({ type: 'SKIP_WAITING' }), 300);
      setTimeout(() => location.reload(), 4000); // fallback
    } }, 'Update now'));
  document.body.appendChild(banner);
  // Ask the waiting version for its number.
  try {
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => { if (e.data && e.data.version) ver.textContent = `Version ${e.data.version} is available`; };
    worker.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
  } catch (e) {}
}

function watchWorker(worker) {
  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(worker);
  });
}

async function checkForUpdate() {
  if (!swReg) { toast('Updates need a connection and a normal web address.'); return; }
  try {
    await swReg.update();
    if (swReg.waiting && navigator.serviceWorker.controller) showUpdateBanner(swReg.waiting);
    else if (swReg.installing) { toast('Downloading update…'); watchWorker(swReg.installing); }
    else toast(`You have the latest version (${APP_VERSION}).`);
  } catch (e) { toast('Couldn’t check for updates. Are you online?'); }
}

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    swReg = await navigator.serviceWorker.register('sw.js');
    if (swReg.waiting && navigator.serviceWorker.controller) showUpdateBanner(swReg.waiting);
    swReg.addEventListener('updatefound', () => { if (swReg.installing) watchWorker(swReg.installing); });
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (updating) location.reload(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') swReg.update().catch(() => {}); });
    setInterval(() => swReg.update().catch(() => {}), 30 * 60 * 1000);
  } catch (e) { console.warn('Service worker not registered', e); }
}

// ---------- start ----------
document.getElementById('app-version').textContent = APP_VERSION;
registerSW();
route();
window.__sg = { db, APP_VERSION };
