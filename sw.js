// Partners moved to ezRAD.com. This replaces the old app's offline copy: it clears the old cache and removes itself,
// so phones and the TV that installed the old Partners load the forwarding pages (and so the new address) from now on.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
})()));
