const CACHE = 'reading-room-shell-__VERSION__';
const ASSETS = __ASSETS__;
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const index = await fetch('/index.html', {cache:'reload'});
    if (!index.ok) throw new Error('App shell unavailable');
    const html = await index.clone().text();
    const referenced = [...html.matchAll(/(?:src|href)="(\/assets\/[^" ]+)"/g)].map(match => match[1]);
    if (!referenced.length || referenced.some(asset => !ASSETS.includes(asset))) throw new Error('App shell and assets have different versions');
    await cache.addAll(['/icon.svg','/manifest.json',...ASSETS].map(url => new Request(url,{cache:'reload'})));
    await cache.put('/index.html',index);
    // Take control only after the entire new shell is available. Never reload a page
    // automatically: a reader or writer tab may contain unsaved work.
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Keep previous hashed bundles for tabs still running an older release.
    // Remove them only when there are no open windows depending on that shell.
    const windows = await self.clients.matchAll({type:'window',includeUncontrolled:true});
    if (!windows.length) {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k.startsWith('reading-room-shell-') && k !== CACHE).map(k => caches.delete(k)));
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    // Each worker must serve HTML from its own matching asset set.
    event.respondWith(caches.open(CACHE).then(cache => cache.match('/index.html', {ignoreVary:true})).then(cached => cached || fetch(event.request,{cache:'no-store'})));
    return;
  }
  // Static hashes are identical for all origins/credentials; ignore host-added Vary: Origin.
  if (/^\/assets\/[^/]+\.(js|mjs|css)$/.test(url.pathname)) event.respondWith((async () => {
    const current = await caches.open(CACHE);
    const cached = await current.match(event.request, {ignoreVary:true});
    if (cached) return cached;
    for (const name of await caches.keys()) {
      if (!name.startsWith('reading-room-shell-') || name === CACHE) continue;
      const older = await (await caches.open(name)).match(event.request, {ignoreVary:true});
      if (older) return older;
    }
    return fetch(event.request);
  })());
});
