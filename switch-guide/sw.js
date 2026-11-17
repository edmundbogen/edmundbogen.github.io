// Switch Guide service worker: caches the whole app so it opens and makes PDFs with no signal.
// When a new version is published, this file changes (VERSION), the phone downloads the new
// copy in the background, and the app shows "Update available". Data in IndexedDB is never touched.
const VERSION = '1.0.0';
const CACHE = 'switch-guide-' + VERSION;
const FILES = [
  './',
  'index.html',
  'how-to.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/actions.js',
  'js/backup.js',
  'js/config.js',
  'js/db.js',
  'js/editor.js',
  'js/font-coverage.js',
  'js/images.js',
  'js/pdf.js',
  'js/secrets.js',
  'js/share.js',
  'js/sortable.js',
  'js/util.js',
  'vendor/jspdf.umd.min.js',
  'vendor/fflate.min.js',
  'vendor/qrcode.js',
  'fonts/CormorantGaramond-Medium.ttf',
  'fonts/CormorantGaramond-Italic.ttf',
  'fonts/Inter-Regular.ttf',
  'fonts/Inter-SemiBold.ttf',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: 'reload' skips the browser's HTTP cache so a new version never mixes in old files.
    await Promise.all(FILES.map(async (f) => {
      const res = await fetch(new Request(f, { cache: 'reload' }));
      if (!res.ok) throw new Error('Failed to cache ' + f);
      await cache.put(f, res);
    }));
  })());
  // No skipWaiting here: an update waits until the agent taps "Update now".
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('switch-guide-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'SKIP_WAITING') self.skipWaiting();
  if (msg.type === 'GET_VERSION' && event.ports && event.ports[0]) event.ports[0].postMessage({ version: VERSION });
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = await cache.match('index.html');
      try { return await fetch(req); } catch (e) { if (shell) return shell; throw e; }
    }
    return fetch(req);
  })());
});
