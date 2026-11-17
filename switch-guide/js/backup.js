// Export / import one property as a single .switchguide file.
// The file is a zip: data.json (with formatVersion) + photos/ + thumbs/.
// Photos are stored as-is (no recompression) so a backup round-trips exactly.
import { FORMAT_VERSION, APP_VERSION } from './config.js';
import * as db from './db.js';
import { uid, safeFileName } from './util.js';

const fflate = () => window.fflate;

// One function per format step. MIGRATIONS[n] turns a version-n file into version n+1.
// Keep every step forever so backups made today still open after later releases.
const MIGRATIONS = {
  // 1: (d) => { d.property.extras = d.property.extras || {}; return d; },
};

export function migrate(d) {
  if (!d || d.format !== 'switchguide') throw new Error("This file isn't a Switch Guide backup.");
  let v = Number(d.formatVersion) || 0;
  if (v < 1) throw new Error("This backup file is damaged (missing version).");
  if (v > FORMAT_VERSION) {
    throw new Error('This backup was made with a newer version of Switch Guide. Update the app (About → Check for updates), then import again.');
  }
  while (v < FORMAT_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`Can't upgrade backup from format ${v}.`);
    d = step(d);
    v += 1;
    d.formatVersion = v;
  }
  return normalize(d);
}

// Fill in defaults so files missing newer optional fields still import cleanly.
function normalize(d) {
  const str = (v, max = 2000) => (v === undefined || v === null ? '' : String(v).slice(0, max));
  d.property = d.property || {};
  d.property.address = str(d.property.address, 300) || 'Untitled property';
  d.property.cityLine = str(d.property.cityLine, 300);
  d.property.guideUrl = str(d.property.guideUrl, 2000);
  d.property.extras = d.property.extras && typeof d.property.extras === 'object' ? d.property.extras : {};
  d.rooms = (d.rooms || []).map((r, i) => ({ id: str(r.id) || uid(), name: str(r.name, 200) || 'Room', order: Number.isFinite(r.order) ? r.order : i }));
  const roomIds = new Set(d.rooms.map((r) => r.id));
  d.banks = (d.banks || []).filter((b) => roomIds.has(b.roomId)).map((b, i) => ({
    id: str(b.id) || uid(), roomId: b.roomId, location: str(b.location, 200), photoId: b.photoId || null,
    order: Number.isFinite(b.order) ? b.order : i,
  }));
  const bankIds = new Set(d.banks.map((b) => b.id));
  const clamp = (n) => Math.min(1, Math.max(0, Number(n) || 0));
  d.switches = (d.switches || []).filter((s) => bankIds.has(s.bankId)).map((s, i) => ({
    id: str(s.id) || uid(), bankId: s.bankId, order: Number.isFinite(s.order) ? s.order : i,
    x: clamp(s.x), y: clamp(s.y), label: str(s.label, 500), type: str(s.type, 20) || 'unknown',
    note: str(s.note, 2000), showing: !!s.showing,
  }));
  d.photos = d.photos || [];
  return d;
}

async function photoEntry(id, files) {
  const [p, t] = await Promise.all([db.get('photos', id), db.get('thumbs', id)]);
  if (!p) return null;
  const ext = p.type === 'image/png' ? 'png' : 'jpg';
  files[`photos/${id}.${ext}`] = [new Uint8Array(p.data), { level: 0 }];
  const entry = { id, type: p.type, w: p.w, h: p.h, file: `photos/${id}.${ext}` };
  if (t) {
    const text = t.type === 'image/png' ? 'png' : 'jpg';
    files[`thumbs/${id}.${text}`] = [new Uint8Array(t.data), { level: 0 }];
    Object.assign(entry, { thumbFile: `thumbs/${id}.${text}`, thumbType: t.type, thumbW: t.w, thumbH: t.h });
  }
  return entry;
}

function imgToFile(name, img, files) {
  if (!img || !img.data) return null;
  const ext = img.type === 'image/png' ? 'png' : 'jpg';
  files[`profile/${name}.${ext}`] = [new Uint8Array(img.data), { level: 0 }];
  return { file: `profile/${name}.${ext}`, type: img.type, w: img.w, h: img.h };
}

export async function exportProperty(propertyId, onProgress = () => {}) {
  const tree = await db.loadPropertyTree(propertyId);
  if (!tree) throw new Error('Property not found.');
  const { property } = tree;
  const files = {};
  const photoIds = [property.heroPhotoId, ...tree.banks.map((b) => b.photoId)].filter(Boolean);
  const photos = [];
  for (let i = 0; i < photoIds.length; i++) {
    const e = await photoEntry(photoIds[i], files);
    if (e) photos.push(e);
    onProgress((i + 1) / (photoIds.length + 1));
  }
  const profile = await db.kvGet('profile');
  let profileOut = null;
  if (profile) {
    const { headshot, logo, ...rest } = profile;
    profileOut = { ...rest, headshot: imgToFile('headshot', headshot, files), logo: imgToFile('logo', logo, files) };
  }
  const data = {
    format: 'switchguide',
    formatVersion: FORMAT_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    property: {
      id: property.id, address: property.address, cityLine: property.cityLine || '', heroPhotoId: property.heroPhotoId || null,
      guideUrl: property.guideUrl || '', createdAt: property.createdAt, updatedAt: property.updatedAt, extras: property.extras || {},
    },
    rooms: tree.rooms.map((r) => ({ id: r.id, name: r.name, order: r.order })),
    banks: tree.banks.map((b) => ({ id: b.id, roomId: b.roomId, location: b.location || '', photoId: b.photoId || null, order: b.order })),
    switches: tree.switches.map((s) => ({ id: s.id, bankId: s.bankId, order: s.order, x: s.x, y: s.y, label: s.label || '', type: s.type || 'unknown', note: s.note || '', showing: !!s.showing })),
    photos,
    profile: profileOut,
  };
  files['data.json'] = fflate().strToU8(JSON.stringify(data, null, 1));
  const zipped = fflate().zipSync(files, { level: 6 });
  onProgress(1);
  const blob = new Blob([zipped], { type: 'application/zip' });
  const stamp = new Date().toISOString().slice(0, 10);
  return { blob, filename: `${safeFileName(property.address)} ${stamp}.switchguide` };
}

export async function readBackup(file) {
  let entries;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    entries = fflate().unzipSync(buf);
  } catch (e) {
    throw new Error("This file couldn't be opened. Make sure it's a .switchguide backup.");
  }
  if (!entries['data.json']) throw new Error("This file isn't a Switch Guide backup.");
  let data;
  try { data = JSON.parse(fflate().strFromU8(entries['data.json'])); }
  catch (e) { throw new Error('This backup file is damaged.'); }
  data = migrate(data);
  return { data, entries };
}

// mode: 'new' (no conflict), 'replace' (overwrite same property), 'copy' (new ids)
export async function importBackup({ data, entries }, mode, onProgress = () => {}) {
  const map = new Map();
  const id = (old) => {
    if (!old) return old;
    if (mode !== 'copy') return old;
    if (!map.has(old)) map.set(old, uid());
    return map.get(old);
  };
  const propertyId = id(data.property.id || uid());
  if (mode === 'replace') await db.deletePropertyDeep(propertyId);

  const photoOk = new Set();
  for (let i = 0; i < data.photos.length; i++) {
    const p = data.photos[i];
    const bytes = entries[p.file];
    if (!bytes) continue;
    const pid = id(p.id);
    const ops = [{ store: 'photos', value: { id: pid, propertyId, data: bytes.slice().buffer, type: p.type || 'image/jpeg', w: p.w, h: p.h } }];
    const tb = p.thumbFile && entries[p.thumbFile];
    if (tb) ops.push({ store: 'thumbs', value: { id: pid, data: tb.slice().buffer, type: p.thumbType || 'image/jpeg', w: p.thumbW, h: p.thumbH } });
    await db.batch(ops);
    photoOk.add(p.id);
    onProgress((i + 1) / (data.photos.length + 1));
  }
  const now = Date.now();
  const ops = [];
  ops.push({
    store: 'properties', value: {
      id: propertyId,
      address: mode === 'copy' ? `${data.property.address} (copy)` : data.property.address,
      cityLine: data.property.cityLine,
      heroPhotoId: photoOk.has(data.property.heroPhotoId) ? id(data.property.heroPhotoId) : null,
      guideUrl: data.property.guideUrl,
      createdAt: data.property.createdAt || now,
      updatedAt: now,
      lastBackupAt: now, // the file just imported is itself a backup
      extras: data.property.extras,
    },
  });
  data.rooms.forEach((r) => ops.push({ store: 'rooms', value: { id: id(r.id), propertyId, name: r.name, order: r.order } }));
  data.banks.forEach((b) => ops.push({ store: 'banks', value: { id: id(b.id), propertyId, roomId: id(b.roomId), location: b.location, photoId: photoOk.has(b.photoId) ? id(b.photoId) : null, order: b.order } }));
  data.switches.forEach((s) => ops.push({ store: 'switches', value: { ...s, id: id(s.id), bankId: id(s.bankId), propertyId } }));
  await db.batch(ops);

  // Adopt the branding in the file only if this device has no profile yet.
  let adoptedProfile = false;
  const local = await db.kvGet('profile');
  if ((!local || !local.name) && data.profile && data.profile.name) {
    const img = (ref) => (ref && entries[ref.file] ? { data: entries[ref.file].slice().buffer, type: ref.type, w: ref.w, h: ref.h } : null);
    const { headshot, logo, ...rest } = data.profile;
    await db.kvSet('profile', { ...rest, headshot: img(headshot), logo: img(logo) });
    adoptedProfile = true;
  }
  onProgress(1);
  return { propertyId, adoptedProfile };
}
