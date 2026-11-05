/*
 * FinDB's service worker (v2 Phase 5, the phone app), registered by components/app/OfflineBar.tsx.
 *
 * - Pages: from the network first; the last copy of each is kept so the app still opens without a
 *   connection. Pages hold no financial data (each screen fetches it after loading), so nothing
 *   private is stored here.
 * - Next.js's own files (/_next/static, content-hashed) and the icons: from the cache first.
 * - The API is never cached: balances and entries are never kept on the phone by this worker.
 *   Entries added offline are kept by the page itself (lib/offline-queue.ts), not here.
 *
 * Bump VERSION when this file's caching changes; old caches are deleted on activation.
 */
/* global self, caches */
const VERSION = 'findb-3';
const PAGES = `${VERSION}-pages`;
const ASSETS = `${VERSION}-assets`;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        for (const name of await caches.keys()) if (!name.startsWith(VERSION)) await caches.delete(name);
        await self.clients.claim();
    })());
});

const OFFLINE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>FinDB - offline</title><style>body{font-family:system-ui,sans-serif;margin:0;padding:48px 24px;color:#17251e;background:#f6f8f6}main{max-width:420px;margin:0 auto}h1{font-size:1.4rem}</style></head>
<body><main><h1>You are offline</h1><p>This page has not been opened on this phone before, so it cannot be shown without a connection.</p>
<p>Screens you have opened before still work, and entries you add with Quick add are kept on this phone and sent when you are back online.</p></main></body></html>`;

async function page(request) {
    try {
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') {
            const cache = await caches.open(PAGES);
            await cache.put(new URL(request.url).pathname, response.clone());
        }
        return response;
    } catch {
        const cache = await caches.open(PAGES);
        const path = new URL(request.url).pathname;
        return (await cache.match(path)) ?? (await cache.match('/transactions')) ?? (await cache.match('/setup'))
            ?? new Response(OFFLINE_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': 'default-src \'none\'; style-src \'unsafe-inline\'' } });
    }
}

async function asset(request) {
    const cache = await caches.open(ASSETS);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
}

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
    if (request.mode === 'navigate') {
        event.respondWith(page(request));
    } else if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
        event.respondWith(asset(request));
    }
});

// Reminders (lib/services/reminders.ts): show the notification, and open its screen when tapped
self.addEventListener('push', event => {
    let message;
    try {
        message = event.data ? event.data.json() : {};
    } catch {
        message = {};
    }
    const title = typeof message.title === 'string' ? message.title : 'FinDB';
    event.waitUntil(self.registration.showNotification(title, {
        body: typeof message.body === 'string' ? message.body : '',
        tag: typeof message.tag === 'string' ? message.tag : 'findb',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: { url: typeof message.url === 'string' && message.url.startsWith('/') ? message.url : '/calendar' },
    }));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/calendar';
    event.waitUntil((async () => {
        for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
            if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
                await client.navigate(url);
                return client.focus();
            }
        }
        return self.clients.openWindow(url);
    })());
});

// Share to FinDB (app/manifest.ts share_target): keep what was shared on the phone, in its own
// cache, and open /share to turn it into an entry for review. Nothing is sent to the server here.
const SHARED = 'findb-share';

async function keepShared(request) {
    const form = await request.formData();
    const file = form.get('file');
    const meta = {
        title: String(form.get('title') || ''), text: String(form.get('text') || ''), url: String(form.get('url') || ''),
        file: file && typeof file === 'object' ? { name: file.name, type: file.type } : null,
    };
    const cache = await caches.open(SHARED);
    await cache.put('/shared/meta', new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
    if (meta.file) await cache.put('/shared/file', new Response(file, { headers: { 'Content-Type': file.type || 'application/octet-stream' } }));
    else await cache.delete('/shared/file');
    return Response.redirect('/share', 303);
}

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (event.request.method === 'POST' && url.origin === self.location.origin && url.pathname === '/share-target') {
        event.respondWith(keepShared(event.request));
    }
});
