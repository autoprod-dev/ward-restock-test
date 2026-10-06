/* Ward Restock by Autoprod - service worker.
 * Precaches every file the app uses (app, vendored libraries, icons) so it installs and runs fully
 * offline. Page loads try the network first (so updates arrive) and fall back to the cache when
 * offline; everything else is cache-first. Only same-origin GET requests are handled. */
const VERSION = '1.1.2';
const CACHE = 'ward-restock:' + new URL(self.registration.scope).pathname + ':' + VERSION;
const FILES = ['./', './index.html', './app.css', './app.js', './calc.js', './sample.js', './manifest.webmanifest',
  './vendor/xlsx.full.min.js', './vendor/jsQR.js', './vendor/qrcode.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png', './icons/autoprod-logo-64.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(u => new Request(u, { cache: 'reload' })))));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const prefix = 'ward-restock:' + new URL(self.registration.scope).pathname + ':';
    await Promise.all(keys.filter(k => k.startsWith(prefix) && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => { if (event.data === 'SKIP_WAITING') self.skipWaiting(); });

function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)); }

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await Promise.race([fetch(req, { cache: 'no-cache' }), timeout(5000)]);
        if (res && res.ok) { const c = await caches.open(CACHE); c.put('./index.html', res.clone()); }
        return res;
      } catch (e) {
        const c = await caches.open(CACHE);
        return (await c.match('./index.html')) || (await c.match('./')) || Response.error();
      }
    })());
    return;
  }
  event.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') c.put(req, res.clone());
      return res;
    } catch (e) { return Response.error(); }
  })());
});
