// Partners service worker: lets the app open offline. Pages load network-first so updates arrive right away.
const CACHE = 'partners-v134';
const SHELL = ['./', 'index.html', 'plan.html', 'tv.html', 'theme.js', 'account.js', 'core.js', 'magic.js', 'share.js', 'costumes.js', 'core-butterfly.js', 'partners.js', 'words.html', 'words-version.js', 'manifest.json', 'icon-180.png', 'icon-512.png', 'welcome.html', 'account.html', 'mail.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // never touch Google / relay traffic
  e.respondWith(
    // 'no-cache' makes the phone check GitHub for a newer copy every time instead of reusing one for up to 10 minutes.
    (e.request.mode === 'navigate'
      ? fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }).then(r => r.redirected ? fetch(e.request) : r)   // let the browser handle redirects itself
      : fetch(e.request, { cache: 'no-cache' })).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match(url.pathname.endsWith('tv.html') ? 'tv.html' : url.pathname.endsWith('words.html') ? 'words.html' : url.pathname.endsWith('plan.html') ? 'plan.html' : 'index.html')))
  );
});
