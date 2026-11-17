// Hand a finished file to the phone's share sheet (Save to Files, AirDrop, Mail, Messages),
// with a plain download as the fallback.
import { h, modal, fmtBytes } from './util.js';

export function canShareFile(file) {
  try { return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] })); }
  catch (e) { return false; }
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: 'display:none' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Shows a "ready" dialog. iOS only opens the share sheet straight from a tap,
// so the agent taps Share here after a long PDF finishes.
// Resolves 'shared' | 'downloaded' | null
export function offerFile(blob, filename, { title = 'Ready', note } = {}) {
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  const shareable = canShareFile(file);
  let outcome = null;
  const actions = [];
  if (shareable) {
    actions.push({
      label: 'Share or Save…', kind: 'primary',
      onClick: async () => {
        try { await navigator.share({ files: [file], title: filename }); outcome = 'shared'; return true; }
        catch (e) {
          if (e && e.name === 'AbortError') return false; // agent closed the sheet; keep dialog open
          download(blob, filename); outcome = 'downloaded'; return true;
        }
      },
    });
  }
  actions.push({ label: 'Download', kind: shareable ? 'plain' : 'primary', onClick: () => { download(blob, filename); outcome = 'downloaded'; return true; } });
  actions.push({ label: 'Close', kind: 'plain', value: null });
  return modal({
    title,
    body: h('div', null,
      h('p', { class: 'file-line' }, h('strong', null, filename), h('span', { class: 'muted' }, ' · ' + fmtBytes(blob.size))),
      note ? h('p', { class: 'muted small' }, note) : null),
    actions,
  }).then(() => outcome);
}
