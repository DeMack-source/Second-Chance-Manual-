// ═══════════════════════════════════════════════════════════════
//  Second Chance Litigation Manual — Service Worker
//  Handles offline caching so the app works without internet
// ═══════════════════════════════════════════════════════════════

const CACHE_NAME = 'second-chance-v1';
const APP_VERSION = '1.0.0';

// Files to cache on install — everything needed to run offline
const CORE_ASSETS = [
  './second-chance-manual.html',
  './manifest.json',
  // Google Fonts are cached on first load (see fetch handler below)
];

// External origins we will attempt to cache
const CACHEABLE_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

// ── INSTALL ──────────────────────────────────────────────────────
// Fires once when the service worker is first registered.
// Pre-caches the core app shell so it's available offline immediately.
self.addEventListener('install', (event) => {
  console.log(`[SW] Installing Second Chance v${APP_VERSION}`);

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Pre-caching core assets');
        return cache.addAll(CORE_ASSETS);
      })
      .then(() => {
        // Force this SW to become active immediately
        // without waiting for old tabs to close
        return self.skipWaiting();
      })
      .catch((err) => {
        console.error('[SW] Pre-cache failed:', err);
      })
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────────
// Fires after install. Clean up old caches from previous versions.
self.addEventListener('activate', (event) => {
  console.log(`[SW] Activating Second Chance v${APP_VERSION}`);

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((oldCache) => {
              console.log('[SW] Deleting old cache:', oldCache);
              return caches.delete(oldCache);
            })
        );
      })
      .then(() => {
        // Take control of all open tabs immediately
        return self.clients.claim();
      })
  );
});

// ── FETCH ─────────────────────────────────────────────────────────
// Intercepts every network request from the app.
// Strategy: Cache First for assets, Network First for HTML.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests (POST, PUT, etc.)
  if (request.method !== 'GET') return;

  // Skip Chrome extension requests
  if (url.protocol === 'chrome-extension:') return;

  // ── Strategy: Network First for HTML ──
  // Always try to get the freshest HTML from the network.
  // Fall back to cache if offline.
  if (request.destination === 'document') {
    event.respondWith(networkFirstStrategy(request));
    return;
  }

  // ── Strategy: Cache First for Fonts & Static Assets ──
  // Fonts and images rarely change — serve from cache instantly.
  if (
    CACHEABLE_ORIGINS.some(origin => request.url.startsWith(origin)) ||
    request.destination === 'font' ||
    request.destination === 'image' ||
    request.destination === 'style' ||
    request.destination === 'script'
  ) {
    event.respondWith(cacheFirstStrategy(request));
    return;
  }

  // Default: try network, fall back to cache
  event.respondWith(networkFirstStrategy(request));
});

// ── CACHE FIRST STRATEGY ─────────────────────────────────────────
// Check cache first. If found, return immediately.
// If not found, fetch from network and add to cache.
async function cacheFirstStrategy(request) {
  try {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    // Not in cache — fetch from network
    const networkResponse = await fetch(request);

    // Only cache valid responses
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      // Clone the response — it can only be consumed once
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    console.error('[SW] Cache first strategy failed:', error);
    // Return a basic offline fallback if everything fails
    return offlineFallback(request);
  }
}

// ── NETWORK FIRST STRATEGY ───────────────────────────────────────
// Try the network first. If it fails (offline), serve from cache.
async function networkFirstStrategy(request) {
  try {
    const networkResponse = await fetch(request);

    // Update the cache with the fresh response
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    // Network failed — try cache
    console.warn('[SW] Network failed, trying cache for:', request.url);
    const cachedResponse = await caches.match(request);

    if (cachedResponse) {
      return cachedResponse;
    }

    // Nothing in cache either — return offline fallback
    return offlineFallback(request);
  }
}

// ── OFFLINE FALLBACK ─────────────────────────────────────────────
// What to show when both network and cache fail.
function offlineFallback(request) {
  if (request.destination === 'document') {
    // Try to return the cached main HTML file
    return caches.match('./second-chance-manual.html');
  }

  // For other assets, return a simple error response
  return new Response(
    JSON.stringify({ error: 'Offline — resource not available' }),
    {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

// ── BACKGROUND SYNC (Future Feature) ─────────────────────────────
// Placeholder for syncing bookmarks or notes when back online.
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-user-data') {
    console.log('[SW] Background sync triggered:', event.tag);
    // Future: sync bookmarks, saved notes, etc.
  }
});

// ── PUSH NOTIFICATIONS (Future Feature) ──────────────────────────
// Placeholder for deadline reminder notifications.
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();

  event.waitUntil(
    self.registration.showNotification(data.title || 'Second Chance Manual', {
      body: data.body || 'You have an upcoming legal deadline.',
      icon: './icons/icon-192.png',
      badge: './icons/icon-72.png',
      tag: 'deadline-reminder',
      requireInteraction: true,
      data: { url: data.url || './second-chance-manual.html' }
    })
  );
});

// Handle notification click — open the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // If app is already open, focus it
        for (const client of clientList) {
          if (client.url.includes('second-chance') && 'focus' in client) {
            return client.focus();
          }
        }
        // Otherwise open a new window
        if (clients.openWindow) {
          return clients.openWindow(event.notification.data.url);
        }
      })
  );
});

console.log(`[SW] Second Chance Litigation Manual — Service Worker v${APP_VERSION} loaded`);;
