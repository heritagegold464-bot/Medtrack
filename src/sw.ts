/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<unknown> };

// App shell is precached so MEDTRACK opens offline; data lives in IndexedDB.
precacheAndRoute(self.__WB_MANIFEST as never);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));

self.addEventListener('message', (e) => {
  if ((e.data as { type?: string })?.type === 'SKIP_WAITING') void self.skipWaiting();
});

// Background Web Push (sent by the send-reminders Edge Function).
self.addEventListener('push', (event) => {
  let data: { title?: string; body?: string; tag?: string; url?: string } = {};
  try { data = event.data?.json() ?? {}; } catch { data = { body: event.data?.text() }; }
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'MEDTRACK', {
      body: data.body ?? '',
      tag: data.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string })?.url ?? '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) { void c.navigate(url); return c.focus(); }
      return self.clients.openWindow(url);
    }),
  );
});
