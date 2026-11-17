// Switch bank editor: tap the photo to drop a numbered marker, type what it controls.
// Built for speed with one hand: the keyboard stays up between switches, Return saves and
// waits for the next tap, and labels typed earlier in this property appear as one-tap chips.
import * as db from './db.js';
import { h, toast, modal, confirmDialog, promptDialog, uid, pickFile } from './util.js';
import { fill } from './util.js';
import { urlFor } from './images.js';
import { SWITCH_TYPES, LABEL_STARTERS } from './config.js';
import { topbar, navigate, addBankFlow, replacePhotoFlow, bankTitle } from './actions.js';

const LOCATION_SUGGESTIONS = ['By the front door', 'Left of entry', 'Right of entry', 'By the garage door', 'Top of stairs', 'Bottom of stairs', 'Hall side', 'Bedside', 'By the sliders', 'Inside closet'];

export function inferType(label) {
  const t = (label || '').toLowerCase();
  if (/\bfans?\b|exhaust/.test(t)) return 'fan';
  if (/shade|blind|drape|curtain|screen/.test(t)) return 'shades';
  if (/outlet|receptacle|plug/.test(t)) return 'outlet';
  if (/keypad|scene/.test(t)) return 'keypad';
  if (/dimmer/.test(t)) return 'dimmer';
  if (/3-?way|three-?way/.test(t)) return '3way';
  return null;
}

export async function renderEditor(app, bankId) {
  const bank = await db.get('banks', bankId);
  if (!bank) { navigate('#/'); return; }
  const [room, property, photo, allSwitches] = await Promise.all([
    db.get('rooms', bank.roomId), db.get('properties', bank.propertyId), bank.photoId ? db.get('photos', bank.photoId) : null,
    db.byIndex('switches', 'propertyId', bank.propertyId),
  ]);
  if (!room || !property) { navigate('#/'); return; }
  const roomBanks = (await db.byIndex('banks', 'roomId', room.id)).sort((a, b) => a.order - b.order);
  const bankIndex = roomBanks.findIndex((b) => b.id === bank.id);

  let switches = allSwitches.filter((s) => s.bankId === bank.id).sort((a, b) => a.order - b.order);
  // Label suggestions: everything typed in this property, most used first.
  const freq = new Map();
  for (const s of allSwitches) if (s.label) freq.set(s.label, (freq.get(s.label) || 0) + 1);

  let current = null;      // switch being labeled
  let committedLabel = ''; // its label before this round of typing
  let saveTimer = null;
  let detailsOpen = false;

  // ---------- DOM ----------
  const img = h('img', { class: 'bank-photo', alt: 'Switch plate photo', draggable: false });
  if (photo) img.src = urlFor(photo);
  const markers = h('div', { class: 'markers' });
  const photoWrap = h('div', { class: 'photo-wrap' }, img, markers);
  const hint = h('p', { class: 'hint center' });
  const legend = h('ol', { class: 'legend' });

  const numBadge = h('span', { class: 'sheet-num' });
  const input = h('input', {
    class: 'sheet-input', type: 'text', maxLength: 500, placeholder: 'What does it control?',
    autocomplete: 'off', autocapitalize: 'sentences', enterkeyhint: 'next', 'aria-label': 'Switch label',
  });
  const chips = h('div', { class: 'chips scroll', role: 'list' });
  const detailsBtn = h('button', { class: 'btn-icon-text', type: 'button' }, 'Details');
  const doneBtn = h('button', { class: 'btn btn-primary btn-small', type: 'button' }, 'Done');
  const details = h('div', { class: 'sheet-details', hidden: true });
  const sheet = h('div', { class: 'sheet', hidden: true },
    h('div', { class: 'sheet-row' }, numBadge, input),
    chips,
    h('div', { class: 'sheet-row sheet-actions' }, detailsBtn, h('span', { class: 'spacer' }), doneBtn),
    details);

  const menuBtn = h('button', { class: 'icon-btn', 'aria-label': 'Switch bank options', onclick: () => bankMenu() }, '•••');
  const addAnother = h('button', { class: 'btn btn-plain full', type: 'button', onclick: () => addBankFlow(room) }, '+ Add another switch bank in ' + room.name);
  const backToRooms = h('button', { class: 'btn btn-plain full', type: 'button', onclick: () => navigate('#/p/' + property.id) }, 'Back to all rooms');

  fill(app, 
    topbar({ back: '#/p/' + property.id, title: room.name, subtitle: bankTitle(bank, bankIndex, roomBanks.length), right: menuBtn }),
    h('main', { class: 'editor' }, photo ? photoWrap : h('div', { class: 'empty-photo' }, 'No photo. Use ••• → Replace photo.'), hint, legend, h('div', { class: 'stack' }, addAnother, backToRooms)),
    sheet,
  );

  // ---------- rendering ----------
  function renderMarkers() {
    fill(markers, ...switches.map((s, i) => {
      const m = h('button', {
        class: 'marker' + (current && current.id === s.id ? ' selected' : '') + (s.label ? '' : ' empty'),
        type: 'button', 'aria-label': `Switch ${i + 1}${s.label ? ': ' + s.label : ''}`,
        style: { left: s.x * 100 + '%', top: s.y * 100 + '%' },
        dataset: { id: s.id },
      }, String(i + 1));
      attachMarkerDrag(m, s);
      return m;
    }));
  }

  function renderLegend() {
    fill(legend, ...switches.map((s, i) => {
      const type = s.type && s.type !== 'unknown' ? SWITCH_TYPES.find((t) => t.id === s.type)?.label : '';
      const star = h('button', {
        class: 'star' + (s.showing ? ' on' : ''), type: 'button',
        'aria-pressed': s.showing ? 'true' : 'false', 'aria-label': 'Turn on for showings',
        title: 'Turn on for showings',
        onclick: (e) => { e.stopPropagation(); s.showing = !s.showing; persist(s); renderLegend(); if (current && current.id === s.id) renderDetails(); },
      }, s.showing ? '★' : '☆');
      return h('li', { class: 'legend-row' + (current && current.id === s.id ? ' selected' : ''), onclick: () => select(s, true) },
        h('span', { class: 'num' }, String(i + 1)),
        h('span', { class: 'legend-text' },
          h('span', { class: 'legend-label' + (s.label ? '' : ' muted') }, s.label || 'No label yet'),
          (type || s.note) ? h('span', { class: 'legend-sub' }, [type, s.note].filter(Boolean).join(' · ')) : null),
        star);
    }));
    hint.textContent = switches.length
      ? 'Tap another switch in the photo to add it. Drag a number to move it. ★ = turn on for showings.'
      : 'Tap each switch in the photo, in any order. A numbered marker appears and you type what it controls.';
  }

  function nextNumberText() {
    return current ? '#' + (switches.indexOf(current) + 1) : '#' + (switches.length + 1);
  }

  function renderChips() {
    const q = input.value.trim().toLowerCase();
    let list = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
    for (const s of LABEL_STARTERS) if (!freq.has(s)) list.push(s);
    if (q) {
      const starts = list.filter((l) => l.toLowerCase().startsWith(q) && l.toLowerCase() !== q);
      const contains = list.filter((l) => !l.toLowerCase().startsWith(q) && l.toLowerCase().includes(q));
      list = [...starts, ...contains];
    }
    list = list.slice(0, 10);
    fill(chips, ...list.map((l) => h('button', {
      class: 'chip', type: 'button', role: 'listitem',
      onpointerdown: (e) => e.preventDefault(), // keep the keyboard up
      onclick: () => { input.value = l; commit(); },
    }, l)));
    chips.hidden = list.length === 0;
  }

  function renderDetails() {
    if (!detailsOpen || !current) { details.hidden = true; detailsBtn.textContent = 'Details'; return; }
    details.hidden = false;
    detailsBtn.textContent = 'Hide details';
    const s = current;
    const typeChips = h('div', { class: 'chips wrap' }, SWITCH_TYPES.map((t) => h('button', {
      class: 'chip' + (s.type === t.id ? ' on' : ''), type: 'button',
      onpointerdown: (e) => e.preventDefault(),
      onclick: () => { s.type = t.id; persist(s); renderDetails(); renderLegend(); },
    }, t.label)));
    const note = h('textarea', { class: 'field', rows: 2, maxLength: 2000, placeholder: 'Note (optional), e.g. “Hold to dim”' });
    note.value = s.note || '';
    note.addEventListener('input', () => { s.note = note.value; schedulePersist(s); });
    note.addEventListener('blur', () => renderLegend());
    const showing = h('label', { class: 'toggle' },
      h('input', { type: 'checkbox', checked: !!s.showing, onchange: (e) => { s.showing = e.target.checked; persist(s); renderLegend(); } }),
      h('span', null, 'Turn on for showings'));
    const delBtn = h('button', { class: 'btn btn-danger-text', type: 'button', onclick: () => deleteSwitch(s) }, 'Delete switch #' + (switches.indexOf(s) + 1));
    fill(details, h('div', { class: 'label-sm' }, 'Type'), typeChips, h('div', { class: 'label-sm' }, 'Note'), note, showing, delBtn);
  }

  function fitPhoto() {
    if (!photo) return;
    const vv = window.visualViewport;
    const vh = vv ? vv.height : window.innerHeight;
    const top = document.querySelector('.topbar')?.offsetHeight || 56;
    // Always leave room for the label panel so the photo doesn't jump when it opens or closes.
    // It only shrinks further when the keyboard (or expanded details) needs the space.
    const sheetH = Math.max(150, sheet.hidden ? 0 : sheet.offsetHeight);
    const max = Math.max(180, vh - top - sheetH - 16);
    img.style.maxHeight = max + 'px';
  }

  function placeSheet() {
    const vv = window.visualViewport;
    if (!vv) return;
    const covered = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
    sheet.style.transform = covered ? `translateY(${-covered}px)` : '';
    fitPhoto();
  }

  // ---------- actions ----------
  function openSheet(focus) {
    sheet.hidden = false;
    document.body.classList.add('sheet-open');
    numBadge.textContent = nextNumberText();
    input.value = current ? current.label || '' : input.value;
    input.placeholder = current ? 'What does it control?' : 'Tap the next switch in the photo';
    renderChips();
    renderDetails();
    if (focus) { try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); } }
    requestAnimationFrame(() => { placeSheet(); });
  }

  function closeSheet() {
    commit({ keepOpen: false });
    sheet.hidden = true;
    document.body.classList.remove('sheet-open');
    input.blur();
    current = null; detailsOpen = false;
    renderMarkers(); renderLegend();
    requestAnimationFrame(fitPhoto);
  }

  function select(s, focus) {
    if (current && current !== s) commit({ keepOpen: true, quiet: true });
    current = s;
    committedLabel = s.label || '';
    input.value = s.label || '';
    renderMarkers(); renderLegend();
    openSheet(focus);
    if (!focus) return;
    const m = markers.querySelector(`[data-id="${s.id}"]`);
    if (m && m.scrollIntoView) m.scrollIntoView({ block: 'nearest' });
  }

  function persist(s) {
    clearTimeout(saveTimer); saveTimer = null;
    db.put('switches', { ...s }).then(() => db.touchProperty(property.id)).catch((e) => toast('Could not save: ' + e.message));
  }
  function schedulePersist(s) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persist(s), 400);
  }

  // Save the label being typed. With the keyboard up, the next tap continues the flow.
  function commit({ keepOpen = true, quiet = false } = {}) {
    const text = input.value.replace(/\s+/g, ' ').trim();
    if (current) {
      if (text !== committedLabel) {
        if (committedLabel) freq.set(committedLabel, Math.max(0, (freq.get(committedLabel) || 1) - 1));
        current.label = text;
        committedLabel = text;
        if (text) freq.set(text, (freq.get(text) || 0) + 1);
        if ((!current.type || current.type === 'unknown') && inferType(text)) current.type = inferType(text);
      }
      persist(current);
      if (!quiet && keepOpen) {
        current = null;
        input.value = '';
        detailsOpen = false;
        renderMarkers(); renderLegend();
        openSheet(false);
      }
    }
  }

  function addAt(fx, fy) {
    // Text typed before tapping becomes the new switch's label.
    const typedFirst = !current ? input.value.replace(/\s+/g, ' ').trim() : '';
    if (current) commit({ keepOpen: true, quiet: true });
    const s = {
      id: uid(), propertyId: property.id, bankId: bank.id, order: switches.length,
      x: Math.min(1, Math.max(0, fx)), y: Math.min(1, Math.max(0, fy)),
      label: typedFirst, type: (typedFirst && inferType(typedFirst)) || 'unknown', note: '', showing: false,
    };
    if (typedFirst) freq.set(typedFirst, (freq.get(typedFirst) || 0) + 1);
    switches.push(s);
    current = s;
    committedLabel = typedFirst;
    detailsOpen = false;
    renderMarkers(); renderLegend();
    openSheet(true); // focus synchronously so iOS opens the keyboard
    persist(s);
  }

  function deleteSwitch(s) {
    const idx = switches.indexOf(s);
    if (idx < 0) return;
    switches.splice(idx, 1);
    switches.forEach((x, i) => { x.order = i; });
    current = null; detailsOpen = false;
    const ops = [{ store: 'switches', del: s.id }, ...switches.map((x) => ({ store: 'switches', value: { ...x } }))];
    db.batch(ops).then(() => db.touchProperty(property.id));
    closeSheet();
    toast(`Switch deleted. Numbers after it moved up.`, {
      action: { label: 'Undo', run: () => {
        switches.splice(idx, 0, s); switches.forEach((x, i) => { x.order = i; });
        db.batch(switches.map((x) => ({ store: 'switches', value: { ...x } }))).then(() => db.touchProperty(property.id));
        renderMarkers(); renderLegend();
      } },
    });
  }

  function frac(clientX, clientY) {
    const r = img.getBoundingClientRect();
    return [(clientX - r.left) / r.width, (clientY - r.top) / r.height];
  }

  // Tap on the photo = new marker (a scroll or pinch is ignored).
  let tap = null;
  photoWrap.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.marker')) return;
    if (!e.isPrimary) { tap = null; return; }
    tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now() };
    e.preventDefault(); // keeps the keyboard open on iPhone
  });
  photoWrap.addEventListener('pointerup', (e) => {
    if (!tap || e.pointerId !== tap.id) return;
    const moved = Math.hypot(e.clientX - tap.x, e.clientY - tap.y);
    const ok = moved < 12 && Date.now() - tap.t < 900;
    tap = null;
    if (!ok) return;
    const [fx, fy] = frac(e.clientX, e.clientY);
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;
    addAt(fx, fy);
  });
  photoWrap.addEventListener('pointercancel', () => { tap = null; });
  photoWrap.addEventListener('mousedown', (e) => e.preventDefault());

  function attachMarkerDrag(m, s) {
    m.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const sx = e.clientX, sy = e.clientY;
      let dragging = false;
      try { m.setPointerCapture(e.pointerId); } catch (err) {}
      const move = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) { dragging = true; m.classList.add('dragging'); }
        if (dragging) {
          const [fx, fy] = frac(ev.clientX, ev.clientY);
          s.x = Math.min(1, Math.max(0, fx)); s.y = Math.min(1, Math.max(0, fy));
          m.style.left = s.x * 100 + '%'; m.style.top = s.y * 100 + '%';
        }
      };
      const up = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        m.removeEventListener('pointermove', move); m.removeEventListener('pointerup', up); m.removeEventListener('pointercancel', up);
        m.classList.remove('dragging');
        if (dragging) { persist(s); }
        else if (ev.type === 'pointerup') select(s, true);
      };
      m.addEventListener('pointermove', move);
      m.addEventListener('pointerup', up);
      m.addEventListener('pointercancel', up);
    });
  }

  input.addEventListener('input', () => {
    renderChips();
    if (current) { current.label = input.value.trim(); schedulePersist(current); }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (current) commit(); }
    if (e.key === 'Escape') { e.preventDefault(); closeSheet(); }
  });
  detailsBtn.addEventListener('pointerdown', (e) => e.preventDefault());
  detailsBtn.addEventListener('click', () => {
    if (!current) { toast('Tap a switch first.'); return; }
    detailsOpen = !detailsOpen; renderDetails(); requestAnimationFrame(placeSheet);
  });
  doneBtn.addEventListener('pointerdown', (e) => e.preventDefault());
  doneBtn.addEventListener('click', () => closeSheet());

  const vv = window.visualViewport;
  const onVV = () => { if (!sheet.hidden) placeSheet(); };
  if (vv) { vv.addEventListener('resize', onVV); vv.addEventListener('scroll', onVV); }
  window.addEventListener('resize', fitPhoto);
  img.addEventListener('load', fitPhoto);

  // Leaving the screen: save whatever is being typed.
  app._cleanup = () => {
    if (current) { current.label = input.value.replace(/\s+/g, ' ').trim(); persist(current); }
    if (vv) { vv.removeEventListener('resize', onVV); vv.removeEventListener('scroll', onVV); }
    window.removeEventListener('resize', fitPhoto);
    document.body.classList.remove('sheet-open');
  };

  // ---------- bank menu ----------
  async function bankMenu() {
    if (current) commit({ quiet: true });
    let photoPick = null;
    const choice = await modal({
      title: bankTitle(bank, bankIndex, roomBanks.length),
      body: h('p', { class: 'muted small' }, `${room.name} · ${switches.length} ${switches.length === 1 ? 'switch' : 'switches'}`),
      actions: [
        { label: 'Name this switch bank', kind: 'plain', value: 'rename' },
        { label: 'Renumber left to right', kind: 'plain', value: 'renumber' },
        { label: 'Move to another room', kind: 'plain', value: 'move' },
        { label: 'Replace photo', kind: 'plain', value: 'photo', onClick: () => { photoPick = pickFile({ accept: 'image/*' }); } },
        { label: 'Delete switch bank', kind: 'danger', value: 'delete' },
        { label: 'Cancel', kind: 'plain', value: null },
      ],
      className: 'menu',
    });
    if (choice === 'rename') {
      const v = await promptDialog('Where is this switch bank?', { value: bank.location || '', placeholder: 'e.g. By the front door', suggestions: LOCATION_SUGGESTIONS, help: 'Optional. Helps when a room has more than one bank.' });
      if (v !== null) { bank.location = v; await db.put('banks', bank); await db.touchProperty(property.id); renderEditor(app, bank.id); }
    } else if (choice === 'renumber') {
      // Group into rows (markers within ~6% height of each other), then left to right.
      const sorted = [...switches].sort((a, b) => a.y - b.y);
      const rows = [];
      for (const s of sorted) {
        const row = rows.find((r) => Math.abs(r.y - s.y) < 0.06);
        if (row) { row.items.push(s); row.y = (row.y + s.y) / 2; } else rows.push({ y: s.y, items: [s] });
      }
      switches = rows.sort((a, b) => a.y - b.y).flatMap((r) => r.items.sort((a, b) => a.x - b.x));
      switches.forEach((s, i) => { s.order = i; });
      await db.batch(switches.map((s) => ({ store: 'switches', value: { ...s } })));
      await db.touchProperty(property.id);
      renderMarkers(); renderLegend();
      toast('Renumbered left to right, top to bottom.');
    } else if (choice === 'move') {
      const rooms = (await db.byIndex('rooms', 'propertyId', property.id)).sort((a, b) => a.order - b.order).filter((r) => r.id !== room.id);
      if (!rooms.length) { toast('Add another room first.'); return; }
      const target = await modal({
        title: 'Move to which room?', body: '',
        actions: [...rooms.map((r) => ({ label: r.name, kind: 'plain', value: r.id })), { label: 'Cancel', kind: 'plain', value: null }],
        className: 'menu',
      });
      if (target) {
        const others = await db.byIndex('banks', 'roomId', target);
        bank.roomId = target; bank.order = others.length;
        await db.put('banks', bank); await db.touchProperty(property.id);
        toast('Moved.');
        renderEditor(app, bank.id);
      }
    } else if (choice === 'photo') {
      const ok = await replacePhotoFlow(bank, photoPick);
      if (ok) { toast('Photo replaced. Check that each number still sits on its switch.'); renderEditor(app, bank.id); }
    } else if (choice === 'delete') {
      const yes = await confirmDialog('Delete this switch bank?', `This removes the photo and all ${switches.length} switches in it. There is no copy anywhere else, so this can't be undone.`, 'Delete', true);
      if (yes) {
        await db.deleteBankDeep(bank);
        await db.touchProperty(property.id);
        toast('Switch bank deleted.');
        navigate('#/p/' + property.id);
      }
    }
  }

  renderMarkers();
  renderLegend();
  fitPhoto();
}
