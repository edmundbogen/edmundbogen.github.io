// Switch Guide — app-wide settings.
// To publish a new version, run:  ./bump-version.sh 1.0.1   (updates this file and sw.js together)

export const APP_NAME = 'Switch Guide';
export const APP_VERSION = '1.0.0';

// Version of the backup (.switchguide) file format. Increase only when the
// file's structure changes, and add a matching step to MIGRATIONS in backup.js.
export const FORMAT_VERSION = 1;

// Credit line shown in About and in every PDF footer.
export const CREDIT = {
  text: 'Switch Guide by Edmund Bogen',
  url: 'https://bogen.ai',
};

export const DISCLAIMER =
  'This guide is a convenience reference to the light switches in this home, prepared by the listing agent. ' +
  'It is not electrical documentation and has not been verified by a licensed electrician.';

export const DISCLAIMER_SHORT =
  'Convenience reference only. Not electrical documentation; not verified by an electrician.';

// Photo sizes. 1600 px on the long side prints sharply at guide size (~5 in wide at 300 dpi).
export const PHOTO_MAX = 1600;
export const THUMB_MAX = 420;
export const JPEG_QUALITY = 0.82;

export const SWITCH_TYPES = [
  { id: 'onoff', label: 'On/off' },
  { id: 'dimmer', label: 'Dimmer' },
  { id: '3way', label: '3-way' },
  { id: 'fan', label: 'Fan' },
  { id: 'shades', label: 'Shades' },
  { id: 'keypad', label: 'Scene keypad' },
  { id: 'outlet', label: 'Outlet' },
  { id: 'unknown', label: 'Unknown' },
];

export const DEFAULT_ACCENT = '#2f3b45';
export const ACCENT_PRESETS = ['#2f3b45', '#1f2a44', '#24453a', '#5b2333', '#8a6d3b', '#6b6b6b', '#111111'];

export const ROOM_SUGGESTIONS = [
  'Foyer', 'Living Room', 'Family Room', 'Dining Room', 'Kitchen', 'Breakfast Nook', 'Pantry',
  'Laundry', 'Hallway', 'Stairs', 'Office', 'Library', 'Primary Bedroom', 'Primary Bath',
  'Primary Closet', 'Guest Bedroom', 'Guest Bath', 'Powder Room', 'Media Room', 'Gym',
  'Wine Room', 'Bar', 'Garage', 'Loggia', 'Lanai', 'Pool Deck', 'Summer Kitchen', 'Exterior',
];

export const LABEL_STARTERS = [
  'Recessed lights', 'Chandelier', 'Pendants', 'Sconces', 'Ceiling fan', 'Fan light',
  'Under-cabinet lights', 'Exterior lights', 'Landscape lights', 'Pool light', 'Outlet',
  'Closet light', 'Vanity lights', 'Exhaust fan', 'Shades', 'Accent lights', 'Hall lights',
];
