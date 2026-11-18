const CACHE_PREFIX = `bausplit:${self.registration.scope}:`;
const CACHE_NAME = `${CACHE_PREFIX}v1`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Solo la parte statica di BauSplit, mai inviti, credenziali o dati Supabase.
  if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope) || new URL(request.url).search) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') await cache.put(request, response.clone()).catch(() => {});
      return response;
    } catch { return (await cache.match(request)) || Response.error(); }
  })());
});
