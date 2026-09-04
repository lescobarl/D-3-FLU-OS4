/* ============================================================
 * FLU OS4 — Service Worker (J2, PWA)
 * ------------------------------------------------------------
 * Estrategias:
 *  - Navegación: network-first con fallback offline a /index.html.
 *  - Estáticos same-origin: cache-first (shell de la app).
 *  - Cross-origin (proxy /api, fuentes, CDN): se omite siempre.
 * Mensaje 'flu-show-notification' → Notifications API del sistema.
 * Regla #1: sin hardcode de rutas duplicadas; versión en CACHE_NAME.
 * Regla #2 (dev): en localhost/127.0.0.1 el SW NO intercepta (siempre red)
 * para que HMR y el código fuente reflejen los cambios al instante.
 * ============================================================ */
const CACHE_NAME = 'flu-os4-shell-v1';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/flu-icon.svg',
  '/icons/flu-icon-maskable.svg',
];

const DEV_HOSTS = ['localhost', '127.0.0.1'];
const IS_DEV = DEV_HOSTS.includes(self.location.hostname);

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.resolve()
      .then(() =>
        IS_DEV
          ? undefined
          : caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

function isSameOrigin(request) {
  const url = new URL(request.url);
  return url.origin === self.location.origin;
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put('/index.html', response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match('/index.html');
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirstStatic(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (IS_DEV) return; // desarrollo: siempre red (HMR y recarga en vivo)
  if (request.method !== 'GET' || !isSameOrigin(request)) return;
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  event.respondWith(cacheFirstStatic(request));
});

self.addEventListener('message', (event) => {
  const { data } = event;
  if (!data || data.type !== 'flu-show-notification') return;
  const notification = data.notification || {};
  self.registration.showNotification(notification.title || 'FLU OS4', {
    body: notification.body || '',
    icon: notification.icon || '/icons/flu-icon.svg',
    badge: notification.icon || '/icons/flu-icon.svg',
    tag: notification.id || 'flu-notification',
    data: { url: notification.url || '/' },
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
