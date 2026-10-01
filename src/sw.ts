/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

// App shell is precached so the app opens (and drafts work) offline.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));
self.skipWaiting();
clientsClaim();

interface ReminderPayload {
  title: string;
  body: string;
  url: string;
  isGroup?: boolean;
  recipientName?: string;
  logId?: string;
  token?: string;
  actionUrl?: string;
  tag?: string;
}

self.addEventListener('push', (event) => {
  let data: ReminderPayload;
  try {
    data = event.data?.json() as ReminderPayload;
  } catch {
    data = { title: 'TexMex', body: event.data?.text() ?? '', url: '/' };
  }

  const body = data.isGroup ? `${data.body}\n\nTap, then pick “${data.recipientName}”.` : data.body;

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag,
      requireInteraction: true,
      data,
      // Not every platform shows actions (iOS doesn't) — tapping the body always opens WhatsApp.
      actions: [
        { action: 'open', title: 'Open in WhatsApp' },
        { action: 'snooze', title: '+15 min' },
      ],
    } as NotificationOptions),
  );
});

self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data as ReminderPayload | undefined;
  event.notification.close();
  if (!data) return;

  const report = (action: 'snooze' | 'opened', extra: Record<string, unknown> = {}) =>
    data.actionUrl && data.logId && data.token
      ? fetch(data.actionUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ logId: data.logId, token: data.token, action, ...extra }),
        }).catch(() => undefined)
      : Promise.resolve(undefined);

  if (event.action === 'snooze') {
    event.waitUntil(report('snooze', { minutes: 15 }));
    return;
  }

  event.waitUntil(Promise.all([self.clients.openWindow(data.url), report('opened')]));
});
