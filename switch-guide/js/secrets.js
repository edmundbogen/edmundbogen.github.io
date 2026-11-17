// The guide may be printed and left in the house, so it must never hold codes or passwords.
// This looks for text that resembles one and lets the agent fix it before exporting.

const STRONG = /\b(pass ?words?|passcodes?|pass ?code|wi-?fi|ssid|network key|lock ?box|combination|alarm code|gate code|garage code|door code|access code|security code|disarm|arm code)\b/i;
const WEAK = /\b(codes?|pins?|alarm|gate|garage|keypad|combo|key)\b/i;
const DIGITS3 = /\d{3,}/;
const DIGITS4 = /(^|[^\d])\d{4,}([^\d]|$)/;
const PW_LIKE = /\b(?=[A-Za-z0-9!@#$%^&*]{8,}\b)(?=\S*[A-Za-z])(?=\S*\d)\S+\b/; // mixed letters+digits, 8+ chars

export function looksSecret(text, { numbers = true } = {}) {
  if (!text) return null;
  const t = String(text);
  if (STRONG.test(t)) return 'mentions a password, Wi-Fi, or access code';
  if (!numbers) return null; // addresses legitimately contain long numbers
  if (WEAK.test(t) && DIGITS3.test(t)) return 'looks like a code';
  if (DIGITS4.test(t.replace(/\b(19|20)\d{2}s?\b/g, ''))) return 'contains a long number that could be a code';
  if (PW_LIKE.test(t) && /[a-z]/.test(t) && /[A-Z0-9]/.test(t) && !/\s/.test(t.trim())) return 'looks like a password';
  return null;
}

// tree from db.loadPropertyTree. Returns [{where, text, reason}]
export function scanTree(tree) {
  const hits = [];
  const check = (where, text, opts) => { const r = looksSecret(text, opts); if (r) hits.push({ where, text, reason: r }); };
  check('Property address', tree.property.address, { numbers: false });
  check('Property address', tree.property.cityLine, { numbers: false });
  for (const room of tree.rooms) {
    check('Room name', room.name);
    room.banks.forEach((b, bi) => {
      const bankName = `${room.name} · ${b.location || 'Switch bank ' + (bi + 1)}`;
      check(`${room.name} · bank name`, b.location);
      b.switches.forEach((s, si) => {
        check(`${bankName} · #${si + 1} label`, s.label);
        check(`${bankName} · #${si + 1} note`, s.note);
      });
    });
  }
  return hits;
}
