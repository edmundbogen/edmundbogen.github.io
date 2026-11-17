// Shared UI pieces and flows used by several screens.
import * as db from './db.js';
import { h, uid, toast, modal, busy, pickFile } from './util.js';
import { processPhoto } from './images.js';

export function navigate(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}

export function topbar({ back, title, subtitle, right }) {
  return h('header', { class: 'topbar' },
    back ? h('a', { class: 'icon-btn back', href: back, 'aria-label': 'Back' }, '‹') : h('span', { class: 'icon-btn ghost' }),
    h('div', { class: 'topbar-title' },
      h('div', { class: 'tt-main' }, title || ''),
      subtitle ? h('div', { class: 'tt-sub' }, subtitle) : null),
    right || h('span', { class: 'icon-btn ghost' }));
}

export function bankTitle(bank, idx, n) {
  return bank.location || (n > 1 ? `Switch bank ${idx + 1}` : 'Switch bank');
}

export function friendlyError(e) {
  const msg = (e && (e.message || e.name)) || String(e);
  if (/quota|space|QuotaExceeded/i.test(msg) || (e && e.name === 'QuotaExceededError')) {
    return 'Your phone is out of space for Switch Guide. Back up finished properties, delete them from the app, and try again.';
  }
  return msg;
}

export function showError(title, e) {
  console.error(e);
  return modal({ title, body: friendlyError(e) });
}

export async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch (e) { /* not supported */ }
}

// Downscale and store a photo. Returns the photo id.
export async function savePhoto(file, propertyId) {
  const { full, thumb } = await processPhoto(file);
  const id = uid();
  await db.batch([
    { store: 'photos', value: { id, propertyId, ...full } },
    { store: 'thumbs', value: { id, ...thumb } },
  ]);
  return id;
}

// Must be called straight from a tap (iOS only opens the camera/library from a tap).
export async function addBankFlow(room) {
  const file = await pickFile({ accept: 'image/*' });
  if (!file) return;
  const b = busy('Preparing photo…');
  try {
    const photoId = await savePhoto(file, room.propertyId);
    const banks = await db.byIndex('banks', 'roomId', room.id);
    const order = banks.reduce((m, x) => Math.max(m, x.order + 1), 0);
    const bank = { id: uid(), propertyId: room.propertyId, roomId: room.id, location: '', photoId, order };
    await db.put('banks', bank);
    await db.touchProperty(room.propertyId);
    requestPersist();
    b.close();
    navigate('#/b/' + bank.id);
  } catch (e) {
    b.close();
    showError("Couldn't add that photo", e);
  }
}

// filePromise comes from pickFile() started inside the tap handler.
export async function replacePhotoFlow(bank, filePromise) {
  const file = await filePromise;
  if (!file) return false;
  const b = busy('Preparing photo…');
  try {
    const old = bank.photoId;
    bank.photoId = await savePhoto(file, bank.propertyId);
    await db.put('banks', bank);
    if (old) await db.batch([{ store: 'photos', del: old }, { store: 'thumbs', del: old }]);
    await db.touchProperty(bank.propertyId);
    return true;
  } catch (e) {
    showError("Couldn't use that photo", e);
    return false;
  } finally { b.close(); }
}

export { toast };
