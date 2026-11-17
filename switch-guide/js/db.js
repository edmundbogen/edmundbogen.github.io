// Local storage in IndexedDB. Nothing here ever leaves the device.
//
// Stores:
//   kv        { key, value }                 profile and app settings
//   properties{ id, address, cityLine, heroPhotoId, guideUrl, createdAt, updatedAt, lastBackupAt, extras }
//   rooms     { id, propertyId, name, order }
//   banks     { id, propertyId, roomId, location, photoId, order }
//   switches  { id, propertyId, bankId, order, x, y, label, type, note, showing }
//                x and y are fractions (0–1) of the photo's width and height, so markers
//                land in the same spot at any display size and in the PDF.
//   photos    { id, propertyId, data: ArrayBuffer, type, w, h }   full-size (≤1600 px)
//   thumbs    { id, data: ArrayBuffer, type, w, h }               small copy for lists (same id as photo)
//
// `extras` on a property is reserved for future sections (e.g. other house controls).

const DB_NAME = 'switch-guide';
const DB_VERSION = 1;
let dbp;

export function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      const old = e.oldVersion;
      if (old < 1) {
        db.createObjectStore('kv', { keyPath: 'key' });
        db.createObjectStore('properties', { keyPath: 'id' });
        const rooms = db.createObjectStore('rooms', { keyPath: 'id' });
        rooms.createIndex('propertyId', 'propertyId');
        const banks = db.createObjectStore('banks', { keyPath: 'id' });
        banks.createIndex('propertyId', 'propertyId');
        banks.createIndex('roomId', 'roomId');
        const sw = db.createObjectStore('switches', { keyPath: 'id' });
        sw.createIndex('propertyId', 'propertyId');
        sw.createIndex('bankId', 'bankId');
        const photos = db.createObjectStore('photos', { keyPath: 'id' });
        photos.createIndex('propertyId', 'propertyId');
        db.createObjectStore('thumbs', { keyPath: 'id' });
      }
      // Future schema changes: add `if (old < 2) { ... }` blocks here. Never drop data.
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); location.reload(); };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Close other Switch Guide tabs and try again.'));
  });
  return dbp;
}

function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Storage write was cancelled. The device may be out of space.'));
  });
}

export async function get(store, key) {
  const db = await openDB();
  return reqP(db.transaction(store).objectStore(store).get(key));
}

export async function getAll(store) {
  const db = await openDB();
  return reqP(db.transaction(store).objectStore(store).getAll());
}

export async function byIndex(store, index, value) {
  const db = await openDB();
  return reqP(db.transaction(store).objectStore(store).index(index).getAll(value));
}

export async function put(store, value) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  return txDone(tx);
}

// Many writes in one transaction: ops = [{store, value}] or [{store, del: key}]
export async function batch(ops) {
  if (!ops.length) return;
  const db = await openDB();
  const stores = [...new Set(ops.map((o) => o.store))];
  const tx = db.transaction(stores, 'readwrite');
  for (const o of ops) {
    const s = tx.objectStore(o.store);
    if ('del' in o) s.delete(o.del);
    else s.put(o.value);
  }
  return txDone(tx);
}

export async function del(store, key) {
  return batch([{ store, del: key }]);
}

export async function kvGet(key) {
  const r = await get('kv', key);
  return r ? r.value : undefined;
}
export async function kvSet(key, value) {
  return put('kv', { key, value });
}

// Mark a property as changed (drives the "not backed up" reminder).
export async function touchProperty(propertyId) {
  const p = await get('properties', propertyId);
  if (!p) return;
  p.updatedAt = Date.now();
  await put('properties', p);
}

// Rooms, banks, switches of a property, sorted by walking order.
export async function loadPropertyTree(propertyId) {
  const [property, rooms, banks, switches] = await Promise.all([
    get('properties', propertyId),
    byIndex('rooms', 'propertyId', propertyId),
    byIndex('banks', 'propertyId', propertyId),
    byIndex('switches', 'propertyId', propertyId),
  ]);
  if (!property) return null;
  const byOrder = (a, b) => (a.order - b.order) || (a.id < b.id ? -1 : 1);
  rooms.sort(byOrder);
  banks.sort(byOrder);
  switches.sort(byOrder);
  const swByBank = new Map();
  for (const s of switches) {
    if (!swByBank.has(s.bankId)) swByBank.set(s.bankId, []);
    swByBank.get(s.bankId).push(s);
  }
  const banksByRoom = new Map(rooms.map((r) => [r.id, []]));
  for (const b of banks) {
    b.switches = swByBank.get(b.id) || [];
    if (banksByRoom.has(b.roomId)) banksByRoom.get(b.roomId).push(b);
  }
  for (const r of rooms) r.banks = banksByRoom.get(r.id) || [];
  return { property, rooms, banks, switches };
}

export async function deletePropertyDeep(propertyId) {
  const [rooms, banks, switches, photos] = await Promise.all([
    byIndex('rooms', 'propertyId', propertyId),
    byIndex('banks', 'propertyId', propertyId),
    byIndex('switches', 'propertyId', propertyId),
    byIndex('photos', 'propertyId', propertyId),
  ]);
  const ops = [{ store: 'properties', del: propertyId }];
  rooms.forEach((r) => ops.push({ store: 'rooms', del: r.id }));
  banks.forEach((b) => ops.push({ store: 'banks', del: b.id }));
  switches.forEach((s) => ops.push({ store: 'switches', del: s.id }));
  photos.forEach((p) => { ops.push({ store: 'photos', del: p.id }); ops.push({ store: 'thumbs', del: p.id }); });
  await batch(ops);
}

export async function deleteBankDeep(bank) {
  const switches = await byIndex('switches', 'bankId', bank.id);
  const ops = [{ store: 'banks', del: bank.id }];
  switches.forEach((s) => ops.push({ store: 'switches', del: s.id }));
  if (bank.photoId) { ops.push({ store: 'photos', del: bank.photoId }); ops.push({ store: 'thumbs', del: bank.photoId }); }
  await batch(ops);
}

export async function wipeAll() {
  if (dbp) { (await dbp).close(); dbp = null; }
  await new Promise((resolve, reject) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = resolve; r.onerror = () => reject(r.error); r.onblocked = resolve;
  });
}
