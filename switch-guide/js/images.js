// Photo handling: downscale on import so a 150-switch house doesn't exhaust storage.
import { PHOTO_MAX, THUMB_MAX, JPEG_QUALITY } from './config.js';

export async function loadImage(blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try {
    if (img.decode) await img.decode();
    else await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
  } catch (e) {
    URL.revokeObjectURL(url);
    throw new Error("That photo couldn't be opened. Try a JPEG or PNG, or take the photo again.");
  }
  return { img, url };
}

function canvasFor(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function toBuffer(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (b) => {
      if (!b) return reject(new Error('Could not process the photo (the device may be low on memory).'));
      resolve(await b.arrayBuffer());
    }, type, quality);
  });
}

function release(canvas) { canvas.width = 0; canvas.height = 0; }

function scaledSize(w, h, max) {
  const s = Math.min(1, max / Math.max(w, h));
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}

async function drawScaled(img, max, { type = 'image/jpeg', quality = JPEG_QUALITY, background = '#ffffff' } = {}) {
  const [w, h] = scaledSize(img.naturalWidth, img.naturalHeight, max);
  const c = canvasFor(w, h);
  const ctx = c.getContext('2d');
  if (type === 'image/jpeg') { ctx.fillStyle = background; ctx.fillRect(0, 0, w, h); }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const data = await toBuffer(c, type, quality);
  release(c);
  return { data, type, w, h };
}

// Returns { full: {data,type,w,h}, thumb: {data,type,w,h} }
export async function processPhoto(file, { max = PHOTO_MAX, thumbMax = THUMB_MAX, keepAlpha = false } = {}) {
  const { img, url } = await loadImage(file);
  try {
    const type = keepAlpha ? 'image/png' : 'image/jpeg';
    const full = await drawScaled(img, max, { type });
    const thumb = await drawScaled(img, thumbMax, { type });
    return { full, thumb };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Square, circle-cropped PNG (used for the headshot in PDFs).
export async function circleCrop(buffer, type, size = 400) {
  const { img, url } = await loadImage(new Blob([buffer], { type }));
  try {
    const c = canvasFor(size, size);
    const ctx = c.getContext('2d');
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 4, s, s, 0, 0, size, size);
    const data = await toBuffer(c, 'image/png');
    release(c);
    return new Uint8Array(data);
  } finally { URL.revokeObjectURL(url); }
}

// Crop to a target aspect ratio (cover) and return JPEG bytes.
export async function coverCrop(buffer, type, targetW, targetH, maxPx = 1800) {
  const { img, url } = await loadImage(new Blob([buffer], { type }));
  try {
    const ar = targetW / targetH;
    let sw = img.naturalWidth, sh = sw / ar;
    if (sh > img.naturalHeight) { sh = img.naturalHeight; sw = sh * ar; }
    const sx = (img.naturalWidth - sw) / 2, sy = (img.naturalHeight - sh) / 2;
    const outW = Math.min(maxPx, Math.round(sw)), outH = Math.round(outW / ar);
    const c = canvasFor(outW, outH);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
    const data = await toBuffer(c, 'image/jpeg', 0.86);
    release(c);
    return new Uint8Array(data);
  } finally { URL.revokeObjectURL(url); }
}

// Object URLs for on-screen images; revoked when the screen changes.
const liveUrls = new Set();
export function urlFor(rec) {
  if (!rec || !rec.data) return '';
  const u = URL.createObjectURL(new Blob([rec.data], { type: rec.type || 'image/jpeg' }));
  liveUrls.add(u);
  return u;
}
export function revokeScreenUrls() {
  for (const u of liveUrls) URL.revokeObjectURL(u);
  liveUrls.clear();
}
