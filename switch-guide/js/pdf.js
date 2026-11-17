// PDF generation, entirely on the device (works offline).
// Text and markers are vector; photos are embedded as their original JPEG bytes (no re-decoding),
// one at a time, yielding between pages so a 150-switch house doesn't freeze or crash the tab.
import { SANS_RANGES, SERIF_RANGES } from './font-coverage.js';
import { CREDIT, DISCLAIMER, DISCLAIMER_SHORT, SWITCH_TYPES, DEFAULT_ACCENT } from './config.js';
import * as db from './db.js';
import { circleCrop, coverCrop } from './images.js';
import { hexToRgb, isLight, nextFrame } from './util.js';

const W = 612, H = 792, M = 54;           // US Letter in points, 0.75 in margins
const BOTTOM = H - 74;                     // content stops above the footer
const INK = [30, 30, 32], MUTED = [112, 112, 116], HAIR = [214, 210, 202], SOFT = [246, 244, 240];

// ---------- libraries & fonts ----------
const scripts = {};
function loadScript(src) {
  if (!scripts[src]) {
    scripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve;
      s.onerror = () => { delete scripts[src]; reject(new Error('Could not load the PDF tools. Open the app once with a connection, then try again.')); };
      document.head.appendChild(s);
    });
  }
  return scripts[src];
}
export async function ensureLibs() {
  if (!window.jspdf) await loadScript('vendor/jspdf.umd.min.js');
  if (!window.qrcode) await loadScript('vendor/qrcode.js');
}

let fontsP;
function loadFonts() {
  if (!fontsP) {
    const bin = async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error('Could not load fonts for the PDF.');
      const u = new Uint8Array(await r.arrayBuffer());
      let s = '';
      for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
      return s;
    };
    fontsP = Promise.all([
      bin('fonts/CormorantGaramond-Medium.ttf'), bin('fonts/CormorantGaramond-Italic.ttf'),
      bin('fonts/Inter-Regular.ttf'), bin('fonts/Inter-SemiBold.ttf'),
    ]).catch((e) => { fontsP = null; throw e; });
  }
  return fontsP;
}

async function newDoc(meta) {
  await ensureLibs();
  const [serif, serifI, sans, sansB] = await loadFonts();
  const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'letter', compress: true });
  doc.addFileToVFS('Serif.ttf', serif); doc.addFont('Serif.ttf', 'Serif', 'normal');
  doc.addFileToVFS('SerifI.ttf', serifI); doc.addFont('SerifI.ttf', 'Serif', 'italic');
  doc.addFileToVFS('Sans.ttf', sans); doc.addFont('Sans.ttf', 'Sans', 'normal');
  doc.addFileToVFS('SansB.ttf', sansB); doc.addFont('SansB.ttf', 'Sans', 'bold');
  doc.setProperties({ ...meta, creator: CREDIT.text });
  doc.setLineHeightFactor(1.3);
  return doc;
}

// ---------- text safety ----------
function inRanges(cp, ranges) {
  let lo = 0, hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < ranges[mid][0]) hi = mid - 1;
    else if (cp > ranges[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
}
// Keep only characters the embedded font can draw; strip emoji, fall back to the base letter.
function clean(text, serif = false, keepNewlines = false) {
  const ranges = serif ? SERIF_RANGES : SANS_RANGES;
  let out = '';
  for (const ch of String(text || '').normalize('NFC')) {
    const cp = ch.codePointAt(0);
    if (ch === '\n' || ch === '\r') { out += keepNewlines ? '\n' : ' '; continue; }
    if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) { out += cp === 9 ? ' ' : ''; continue; }
    if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x1f000 && cp <= 0x1faff) || (cp >= 0x2600 && cp <= 0x27bf && !inRanges(cp, ranges)) || (cp >= 0x1f3fb && cp <= 0x1f3ff)) continue;
    if (inRanges(cp, ranges)) { out += ch; continue; }
    const base = ch.normalize('NFD')[0];
    out += inRanges(base.codePointAt(0), ranges) ? base : '?';
  }
  return out.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
}

function font(doc, family, style, size, color = INK) {
  doc.setFont(family, style);
  doc.setFontSize(size);
  doc.setTextColor(...color);
}
// Wrap text; extremely long unbroken strings are split so they never overflow.
function wrap(doc, text, width) {
  const lines = doc.splitTextToSize(text, width);
  const out = [];
  for (const line of lines) {
    if (doc.getTextWidth(line) <= width + 0.5) { out.push(line); continue; }
    let cur = '';
    for (const ch of line) {
      if (doc.getTextWidth(cur + ch) > width) { out.push(cur); cur = ch; } else cur += ch;
    }
    if (cur) out.push(cur);
  }
  return out;
}
function fitOneLine(doc, text, width) {
  if (doc.getTextWidth(text) <= width) return text;
  let t = text;
  while (t.length > 1 && doc.getTextWidth(t + '…') > width) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}
function spaced(doc, text, x, y, opts = {}) {
  doc.setCharSpace(opts.charSpace ?? 1.6);
  doc.text(text, x, y, opts.align ? { align: opts.align } : undefined);
  doc.setCharSpace(0);
}
function lineH(size) { return size * 1.3; }

function accentOf(profile) {
  const hex = (profile && profile.accent) || DEFAULT_ACCENT;
  return { rgb: hexToRgb(hex), onAccent: isLight(hex) ? INK : [255, 255, 255] };
}
const typeLabel = (id) => (id && id !== 'unknown' ? (SWITCH_TYPES.find((t) => t.id === id) || {}).label || '' : '');

function marker(doc, cx, cy, r, n, accent) {
  doc.setFillColor(255, 255, 255);
  doc.circle(cx, cy, r + Math.max(1, r * 0.16), 'F');
  doc.setFillColor(...accent.rgb);
  doc.circle(cx, cy, r, 'F');
  const label = String(n);
  font(doc, 'Sans', 'bold', r * (label.length > 2 ? 0.88 : label.length > 1 ? 1.02 : 1.18), accent.onAccent);
  doc.text(label, cx, cy + r * 0.04, { align: 'center', baseline: 'middle' });
}

async function photoBytes(id, store = 'photos') {
  if (!id) return null;
  const rec = await db.get(store, id);
  if (!rec) return null;
  return { bytes: new Uint8Array(rec.data), type: rec.type === 'image/png' ? 'PNG' : 'JPEG', w: rec.w, h: rec.h };
}

function imageFit(img, maxW, maxH) {
  const s = Math.min(maxW / img.w, maxH / img.h);
  return [img.w * s, img.h * s];
}

// ---------- shared pieces ----------
function agentLine(profile) {
  return [profile.name, profile.brokerage, profile.phone].filter(Boolean).join('  ·  ');
}

function drawFooters(doc, profile, { skipFirst = false, leftText } = {}) {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    const first = i === 1 && skipFirst;
    if (!first) {
      doc.setDrawColor(...HAIR); doc.setLineWidth(0.5); doc.line(M, H - 54, W - M, H - 54);
      font(doc, 'Sans', 'normal', 7.5, MUTED);
      const left = clean(leftText != null ? leftText : agentLine(profile));
      doc.text(fitOneLine(doc, left, W - 2 * M - 60), M, H - 42);
      doc.text(`${i} / ${n}`, W - M, H - 42, { align: 'right' });
    }
    font(doc, 'Sans', 'normal', 6.5, MUTED);
    const lic = profile.license ? `  ·  Lic. ${clean(profile.license)}` : '';
    const disc = fitOneLine(doc, DISCLAIMER_SHORT + (first ? '' : lic), W - 2 * M - doc.getTextWidth(CREDIT.text) - 20);
    doc.text(disc, M, H - 30);
    doc.textWithLink(CREDIT.text, W - M - doc.getTextWidth(CREDIT.text), H - 30, { url: CREDIT.url });
  }
}

function contentRooms(tree) {
  return tree.rooms.filter((r) => r.banks.some((b) => b.photoId || b.switches.length));
}

// ---------- Home Guide ----------
export async function buildHomeGuide(tree, profile, onProgress = () => {}) {
  profile = profile || {};
  const accent = accentOf(profile);
  const address = clean(tree.property.address, true);
  const doc = await newDoc({ title: `${address} — Home Lighting Guide`, author: clean(profile.name || ''), subject: 'Light switch guide' });

  await drawCover(doc, tree, profile, accent);
  onProgress(0.05);

  const rooms = contentRooms(tree);
  const perTocPage = 24;
  const tocPages = Math.max(1, Math.ceil(rooms.length / perTocPage));
  const tocStart = doc.getNumberOfPages() + 1;
  for (let i = 0; i < tocPages; i++) doc.addPage();

  const roomPage = [];
  const totalBanks = rooms.reduce((n, r) => n + r.banks.length, 0) || 1;
  let done = 0;
  for (const room of rooms) {
    doc.addPage();
    roomPage.push(doc.getNumberOfPages());
    let y = roomHeading(doc, room, accent, false);
    for (let bi = 0; bi < room.banks.length; bi++) {
      await nextFrame();
      const bank = room.banks[bi];
      let img = await photoBytes(bank.photoId);
      y = drawBank(doc, room, bank, bi, img, y, accent);
      img = null; // release before the next photo
      done += 1;
      onProgress(0.05 + 0.85 * (done / totalBanks));
    }
  }

  // Contents page(s)
  for (let p = 0; p < tocPages; p++) {
    doc.setPage(tocStart + p);
    let y = M + 6;
    if (p === 0) {
      font(doc, 'Sans', 'bold', 8, accent.rgb);
      spaced(doc, 'CONTENTS', M, y + 8);
      y += 40;
      font(doc, 'Serif', 'normal', 28, INK);
      doc.text(wrap(doc, address, W - 2 * M).slice(0, 2), M, y);
      y += lineH(28) * Math.min(2, wrap(doc, address, W - 2 * M).length) + 6;
      font(doc, 'Sans', 'normal', 9.5, MUTED);
      const how = 'Each room shows a photo of every switch plate with numbered markers. Find the number on the photo, then read what it controls in the list beside it. Switches marked “Turn on for showings” are the ones to light when the home is shown.';
      const hl = wrap(doc, how, W - 2 * M - 60);
      doc.text(hl, M, y + 10);
      y += hl.length * lineH(9.5) + 34;
    }
    const slice = rooms.slice(p * perTocPage, (p + 1) * perTocPage);
    slice.forEach((room, i) => {
      const idx = p * perTocPage + i;
      font(doc, 'Serif', 'normal', 15, INK);
      const name = fitOneLine(doc, clean(room.name, true), W - 2 * M - 70);
      doc.text(name, M, y);
      const nw = doc.getTextWidth(name);
      font(doc, 'Sans', 'normal', 9, MUTED);
      const pg = String(roomPage[idx]);
      doc.text(pg, W - M, y, { align: 'right' });
      doc.setDrawColor(...HAIR); doc.setLineWidth(0.4); doc.setLineDashPattern([0.8, 2.6], 0);
      doc.line(M + nw + 8, y - 2, W - M - doc.getTextWidth(pg) - 8, y - 2);
      doc.setLineDashPattern([], 0);
      doc.link(M, y - 14, W - 2 * M, 18, { pageNumber: roomPage[idx] });
      y += 24;
    });
    if (p === tocPages - 1) {
      y = Math.max(y + 24, BOTTOM - 70);
      doc.setFillColor(...SOFT); doc.rect(M, y, W - 2 * M, 58, 'F');
      font(doc, 'Sans', 'bold', 7, MUTED); spaced(doc, 'PLEASE NOTE', M + 14, y + 17, { charSpace: 1.2 });
      font(doc, 'Sans', 'normal', 8, MUTED);
      doc.text(wrap(doc, DISCLAIMER, W - 2 * M - 28), M + 14, y + 31);
    }
  }
  onProgress(0.95);
  drawFooters(doc, profile, { skipFirst: true });
  await nextFrame();
  const blob = doc.output('blob');
  onProgress(1);
  return { blob, pages: doc.getNumberOfPages() };
}

async function drawCover(doc, tree, profile, accent) {
  const p = tree.property;
  let y;
  if (p.heroPhotoId) {
    const rec = await db.get('photos', p.heroPhotoId);
    if (rec) {
      const heroH = 452;
      const bytes = await coverCrop(rec.data, rec.type, W, heroH);
      doc.addImage(bytes, 'JPEG', 0, 0, W, heroH, 'hero', 'NONE');
      y = heroH + 62;
    }
  }
  if (!y) {
    doc.setFillColor(...accent.rgb); doc.rect(M, 150, 40, 1.5, 'F');
    y = 200;
  }
  font(doc, 'Sans', 'bold', 8.5, accent.rgb);
  spaced(doc, 'HOME LIGHTING GUIDE', M, y, { charSpace: 2.2 });
  y += 38;
  font(doc, 'Serif', 'normal', 34, INK);
  const addr = wrap(doc, clean(p.address, true), W - 2 * M).slice(0, 3);
  doc.text(addr, M, y);
  y += lineH(34) * (addr.length - 1) + 26;
  if (p.cityLine) {
    font(doc, 'Serif', 'italic', 17, MUTED);
    doc.text(wrap(doc, clean(p.cityLine, true), W - 2 * M).slice(0, 2), M, y);
  }

  // Agent block
  const by = H - 150;
  doc.setDrawColor(...HAIR); doc.setLineWidth(0.5); doc.line(M, by, W - M, by);
  let x = M;
  const top = by + 22;
  if (profile.headshot && profile.headshot.data) {
    try {
      const png = await circleCrop(profile.headshot.data, profile.headshot.type, 360);
      doc.addImage(png, 'PNG', M, top, 54, 54, 'headshot', 'FAST');
      x = M + 70;
    } catch (e) { /* skip unreadable headshot */ }
  }
  let logoW = 0;
  if (profile.logo && profile.logo.data) {
    const lw = profile.logo.w || 400, lh = profile.logo.h || 200;
    const s = Math.min(150 / lw, 54 / lh);
    logoW = lw * s;
    try {
      doc.addImage(new Uint8Array(profile.logo.data), profile.logo.type === 'image/png' ? 'PNG' : 'JPEG', W - M - lw * s, top + (54 - lh * s) / 2, lw * s, lh * s, 'logo', 'FAST');
    } catch (e) { logoW = 0; }
  }
  const textW = W - M - x - (logoW ? logoW + 20 : 0);
  font(doc, 'Sans', 'normal', 7.5, MUTED);
  spaced(doc, 'PREPARED BY', x, top + 8, { charSpace: 1.4 });
  font(doc, 'Sans', 'bold', 11, INK);
  doc.text(fitOneLine(doc, clean(profile.name || ''), textW), x, top + 24);
  font(doc, 'Sans', 'normal', 8.5, MUTED);
  const l2 = [profile.brokerage, profile.license ? `Lic. ${profile.license}` : ''].filter(Boolean).join('  ·  ');
  const l3 = [profile.phone, profile.email].filter(Boolean).join('  ·  ');
  if (l2) doc.text(fitOneLine(doc, clean(l2), textW), x, top + 38);
  if (l3) doc.text(fitOneLine(doc, clean(l3), textW), x, top + 51);
}

function roomHeading(doc, room, accent, continued) {
  let y = M + 22;
  font(doc, 'Serif', 'normal', continued ? 18 : 30, INK);
  const lines = wrap(doc, clean(room.name, true) + (continued ? ' (continued)' : ''), W - 2 * M).slice(0, 2);
  doc.text(lines, M, y);
  y += lineH(continued ? 18 : 30) * (lines.length - 1);
  if (!continued) {
    y += 14;
    doc.setFillColor(...accent.rgb); doc.rect(M, y, 36, 1.2, 'F');
    y += 18;
    const nb = room.banks.length, ns = room.banks.reduce((n, b) => n + b.switches.length, 0);
    font(doc, 'Sans', 'normal', 8.5, MUTED);
    doc.text(`${nb} switch ${nb === 1 ? 'bank' : 'banks'}  ·  ${ns} ${ns === 1 ? 'switch' : 'switches'}`, M, y);
    y += 26;
  } else {
    y += 24;
  }
  return y;
}

function legendEntries(doc, bank, width) {
  return bank.switches.map((s, i) => {
    font(doc, 'Sans', 'bold', 10, INK);
    const label = wrap(doc, clean(s.label) || 'No label yet', width);
    font(doc, 'Sans', 'normal', 8.3, MUTED);
    const detailText = [typeLabel(s.type), clean(s.note, false, true)].filter(Boolean).join('  ·  ');
    const detail = detailText ? wrap(doc, detailText, width) : [];
    const h = label.length * lineH(10) + detail.length * lineH(8.3) + (s.showing ? 12 : 0) + 10;
    return { n: i + 1, s, label, detail, h };
  });
}

function drawLegendEntry(doc, e, x, y, width, accent) {
  marker(doc, x + 8, y + 3.2, 7.2, e.n, accent);
  const tx = x + 24;
  font(doc, 'Sans', 'bold', 10, e.s.label ? INK : MUTED);
  doc.text(e.label, tx, y + 6.5);
  let ty = y + 6.5 + e.label.length * lineH(10);
  if (e.detail.length) {
    font(doc, 'Sans', 'normal', 8.3, MUTED);
    doc.text(e.detail, tx, ty - 1);
    ty += e.detail.length * lineH(8.3);
  }
  if (e.s.showing) {
    font(doc, 'Sans', 'bold', 6.8, accent.rgb === undefined ? INK : accent.rgb);
    spaced(doc, 'TURN ON FOR SHOWINGS', tx, ty, { charSpace: 0.9 });
  }
}

function drawBank(doc, room, bank, bi, img, y, accent) {
  const header = clean(bank.location || (room.banks.length > 1 ? `Switch bank ${bi + 1}` : ''));
  const headerH = header ? 18 : 0;
  const maxPW = 292, maxPH = 330;
  const [pw, ph] = img ? imageFit(img, maxPW, maxPH) : [0, 0];
  let lx = img ? M + pw + 26 : M;
  let lw = W - M - lx - 24;
  let entries = legendEntries(doc, bank, lw);
  const legendH = entries.reduce((n, e) => n + e.h, 0);
  const blockH = headerH + Math.max(ph, Math.min(legendH, ph + 120));
  const topOfPage = M + 70;
  if (y + blockH > BOTTOM && y > topOfPage) {
    doc.addPage();
    y = roomHeading(doc, room, accent, true);
  }

  if (header) {
    font(doc, 'Sans', 'bold', 7.5, MUTED);
    spaced(doc, fitOneLine(doc, header.toUpperCase(), W - 2 * M - 40), M, y + 2, { charSpace: 1.3 });
    y += headerH;
  }
  const photoTop = y;
  if (img) {
    doc.addImage(img.bytes, img.type, M, y, pw, ph, 'p' + bank.photoId, 'NONE');
    doc.setDrawColor(...HAIR); doc.setLineWidth(0.5); doc.rect(M, y, pw, ph);
    const r = Math.max(6.5, Math.min(9.5, Math.min(pw, ph) * 0.034));
    bank.switches.forEach((s, i) => marker(doc, M + s.x * pw, y + s.y * ph, r, i + 1, accent));
  }
  if (!entries.length) {
    font(doc, 'Sans', 'normal', 9, MUTED);
    doc.text('No switches marked yet.', lx, y + 10);
    return photoTop + ph + 34;
  }
  let ly = y + 2;
  for (const e of entries) {
    if (ly + e.h > BOTTOM) {
      doc.addPage();
      y = roomHeading(doc, room, accent, true);
      // Continue the legend full width on the new page.
      if (lx !== M) {
        lx = M; lw = W - 2 * M - 24;
        const rest = entries.slice(entries.indexOf(e));
        const re = legendEntries(doc, { switches: rest.map((x) => x.s) }, lw).map((x, k) => ({ ...x, n: rest[k].n }));
        entries = re; ly = y + 2;
        for (const e2 of re) {
          if (ly + e2.h > BOTTOM) { doc.addPage(); ly = roomHeading(doc, room, accent, true) + 2; }
          drawLegendEntry(doc, e2, lx, ly, lw, accent);
          ly += e2.h;
        }
        return ly + 30;
      }
      ly = y + 2;
    }
    drawLegendEntry(doc, e, lx, ly, lw, accent);
    ly += e.h;
  }
  const end = Math.max(photoTop + ph, ly);
  return end + 34;
}

// ---------- Showing Sheet ----------
export async function buildShowingSheet(tree, profile, onProgress = () => {}) {
  profile = profile || {};
  const accent = accentOf(profile);
  const rows = [];
  for (const room of tree.rooms) {
    for (const bank of room.banks) {
      const flagged = bank.switches.map((s, i) => ({ s, n: i + 1 })).filter((x) => x.s.showing);
      if (flagged.length) rows.push({ room, bank, flagged });
    }
  }
  if (!rows.length) throw new Error('No switches are marked “Turn on for showings” yet. Open a switch and turn that on first.');
  const total = rows.reduce((n, r) => n + r.flagged.length, 0);
  const address = clean(tree.property.address, true);
  const doc = await newDoc({ title: `${address} — Showing Sheet`, author: clean(profile.name || '') });

  let y = M + 6;
  font(doc, 'Sans', 'bold', 8, accent.rgb);
  spaced(doc, 'SHOWING SHEET', M, y + 8, { charSpace: 2 });
  y += 36;
  font(doc, 'Serif', 'normal', 24, INK);
  const al = wrap(doc, address, W - 2 * M).slice(0, 2);
  doc.text(al, M, y);
  y += lineH(24) * (al.length - 1) + 18;
  font(doc, 'Sans', 'normal', 9, MUTED);
  const roomsN = new Set(rows.map((r) => r.room.id)).size;
  doc.text(`Turn on these ${total} ${total === 1 ? 'switch' : 'switches'} in walking order (${roomsN} ${roomsN === 1 ? 'room' : 'rooms'}). Numbers match the markers on each photo.`, M, y, { maxWidth: W - 2 * M });
  y += 22;

  // Two columns, filled top to bottom then left to right, so the walking order reads naturally
  // and a typical house fits on one or two pages.
  const GAP = 22, CW = (W - 2 * M - GAP) / 2;
  const thumbW = 72, thumbH = 56, FS = 8.8;
  let col = 0, top = y, lastRoom = null;
  const colX = () => M + col * (CW + GAP);
  const nextColumn = () => {
    if (col === 0) { col = 1; y = top; }
    else { doc.addPage(); col = 0; top = M + 6; y = top; }
    lastRoom = null; // repeat the room name at the top of the new column
  };
  for (let i = 0; i < rows.length; i++) {
    await nextFrame();
    const { room, bank, flagged } = rows[i];
    const img = (await photoBytes(bank.photoId, 'thumbs')) || (await photoBytes(bank.photoId));
    const [tw, th] = img ? imageFit(img, thumbW, thumbH) : [0, 0];
    const twidth = CW - (img ? thumbW + 10 : 0) - 30;
    font(doc, 'Sans', 'normal', FS);
    const lines = flagged.map((f) => ({ ...f, text: wrap(doc, clean(f.s.label) || 'No label', twidth) }));
    const loc = clean(bank.location);
    const textH = (loc ? 11 : 0) + lines.reduce((n, l) => n + l.text.length * lineH(FS) + 4, 0);
    const rowH = Math.max(th, textH) + 10;
    const roomH = room.id !== lastRoom ? 24 : 0;
    if (y + roomH + rowH > BOTTOM) nextColumn();
    const x = colX();
    if (room.id !== lastRoom) {
      font(doc, 'Serif', 'normal', 14, INK);
      doc.text(fitOneLine(doc, clean(room.name, true), CW), x, y + 12);
      doc.setDrawColor(...HAIR); doc.setLineWidth(0.5); doc.line(x, y + 17, x + CW, y + 17);
      y += 24;
      lastRoom = room.id;
    }
    if (img) {
      doc.addImage(img.bytes, img.type, x, y, tw, th, 't' + bank.photoId, 'NONE');
      doc.setDrawColor(...HAIR); doc.rect(x, y, tw, th);
      flagged.forEach((f) => marker(doc, x + f.s.x * tw, y + f.s.y * th, 4.8, f.n, accent));
    }
    const tx = x + (img ? thumbW + 10 : 0);
    let ty = y + 7;
    if (loc) {
      font(doc, 'Sans', 'bold', 6.5, MUTED);
      spaced(doc, fitOneLine(doc, loc.toUpperCase(), twidth + 30), tx, ty, { charSpace: 1 });
      ty += 11;
    }
    for (const l of lines) {
      doc.setDrawColor(...MUTED); doc.setLineWidth(0.6); doc.rect(tx, ty - 6.2, 7, 7);
      marker(doc, tx + 17, ty - 2.7, 5, l.n, accent);
      font(doc, 'Sans', 'normal', FS, INK);
      doc.text(l.text, tx + 27, ty);
      ty += l.text.length * lineH(FS) + 4;
    }
    y += rowH;
    onProgress((i + 1) / rows.length);
  }
  drawFooters(doc, profile);
  const blob = doc.output('blob');
  return { blob, pages: doc.getNumberOfPages() };
}

// ---------- QR card ----------
export function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null;
    return u.href; // ASCII-only (percent-encoded / punycode), safe for the QR encoder
  } catch (e) { return null; }
}

export async function qrMatrix(url) {
  await ensureLibs();
  const qr = window.qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  return qr;
}

function drawQr(doc, qr, x, y, size) {
  const n = qr.getModuleCount();
  const quiet = 2;
  const cell = size / (n + quiet * 2);
  doc.setFillColor(255, 255, 255); doc.rect(x, y, size, size, 'F');
  doc.setFillColor(0, 0, 0);
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.isDark(r, c)) { c++; continue; }
      let e = c;
      while (e + 1 < n && qr.isDark(r, e + 1)) e++;
      doc.rect(x + (c + quiet) * cell, y + (r + quiet) * cell, (e - c + 1) * cell + 0.3, cell + 0.3, 'F'); // slight overlap: no hairline gaps
      c = e + 1;
    }
  }
}

export async function buildQrCard(tree, profile, url) {
  profile = profile || {};
  const accent = accentOf(profile);
  const qr = await qrMatrix(url);
  const address = clean(tree.property.address, true);
  const doc = await newDoc({ title: `${address} — QR card`, author: clean(profile.name || '') });
  const cw = 288, ch = 432, gap = 0;
  const x0 = (W - (cw * 2 + gap)) / 2, y0 = 150;

  let logo = null;
  if (profile.logo && profile.logo.data) logo = { bytes: new Uint8Array(profile.logo.data), type: profile.logo.type === 'image/png' ? 'PNG' : 'JPEG', w: profile.logo.w || 400, h: profile.logo.h || 200 };

  font(doc, 'Sans', 'normal', 8, MUTED);
  doc.text('Print at 100% (actual size). Cut along the dashed lines: one card for inside a kitchen cabinet, one for beside the electrical panel.', W / 2, 110, { align: 'center', maxWidth: W - 2 * M });

  for (let k = 0; k < 2; k++) {
    const x = x0 + k * (cw + gap), y = y0;
    doc.setDrawColor(...MUTED); doc.setLineWidth(0.5); doc.setLineDashPattern([3, 3], 0);
    doc.rect(x, y, cw, ch);
    doc.setLineDashPattern([], 0);
    const pad = 24, iw = cw - pad * 2;
    doc.setFillColor(...accent.rgb); doc.rect(x + pad, y + pad, iw, 2.5, 'F');
    let cy = y + pad + 24;
    font(doc, 'Sans', 'bold', 7.5, accent.rgb);
    spaced(doc, 'HOME LIGHTING GUIDE', x + cw / 2, cy, { align: 'center', charSpace: 1.8 });
    cy += 24;
    font(doc, 'Serif', 'normal', 17, INK);
    const al = wrap(doc, address, iw).slice(0, 2);
    doc.text(al, x + cw / 2, cy, { align: 'center' });
    cy += lineH(17) * (al.length - 1) + 14;
    const qs = 170;
    drawQr(doc, qr, x + (cw - qs) / 2, cy, qs);
    cy += qs + 16;
    font(doc, 'Sans', 'normal', 8.5, INK);
    const cap = wrap(doc, 'Scan with your phone’s camera to see what every light switch in this home controls.', iw - 10);
    doc.text(cap, x + cw / 2, cy, { align: 'center' });
    cy += cap.length * lineH(8.5) + 2;
    font(doc, 'Sans', 'normal', 6, MUTED);
    const ul = wrap(doc, url, iw).slice(0, 2);
    doc.text(ul, x + cw / 2, cy + 2, { align: 'center' });

    const by = y + ch - pad - 34;
    doc.setDrawColor(...HAIR); doc.setLineWidth(0.5); doc.line(x + pad, by - 10, x + cw - pad, by - 10);
    let lwid = 0;
    if (logo) {
      const s = Math.min(84 / logo.w, 32 / logo.h);
      lwid = logo.w * s;
      try { doc.addImage(logo.bytes, logo.type, x + cw - pad - logo.w * s, by + (32 - logo.h * s) / 2, logo.w * s, logo.h * s, 'logo', 'FAST'); } catch (e) { lwid = 0; }
    }
    const tw = iw - (lwid ? lwid + 10 : 0);
    font(doc, 'Sans', 'bold', 8.5, INK);
    doc.text(fitOneLine(doc, clean(profile.name || ''), tw), x + pad, by + 8);
    font(doc, 'Sans', 'normal', 7.5, MUTED);
    if (profile.brokerage) doc.text(fitOneLine(doc, clean(profile.brokerage), tw), x + pad, by + 19);
    if (profile.phone) doc.text(fitOneLine(doc, clean(profile.phone), tw), x + pad, by + 30);
  }
  font(doc, 'Sans', 'normal', 6.5, MUTED);
  doc.text(DISCLAIMER_SHORT, W / 2, y0 + ch + 24, { align: 'center' });
  doc.textWithLink(CREDIT.text, W / 2 - doc.getTextWidth(CREDIT.text) / 2, y0 + ch + 36, { url: CREDIT.url });
  return { blob: doc.output('blob'), pages: 1 };
}
