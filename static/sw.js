/* MadShopper: beskeder på telefonen (prisalarmer). Se docs/prisovervaagning.md.
 *
 * Bevidst KUN push - ingen offline-cache og ingen fetch-handler. Filen ligger
 * under /static/, så den styrer ingen sider (scope /static/), men det er heller
 * ikke nødvendigt: en push-besked når frem uanset scope. Beskeden er krypteret
 * af updater.py (push_notify.py) og indeholder {title, body, url}. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'MadShopper', {
    body: d.body || '',
    icon: '/static/icon-192.png',
    badge: '/static/icon-192.png',
    lang: 'da',
    data: { url: d.url || '/' }
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  // Kun egne sider: en besked kan aldrig sende brugeren ud på et andet site.
  var url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin);
  if (url.origin !== self.location.origin) url = new URL('/', self.location.origin);
  e.waitUntil(self.clients.openWindow(url.href));
});
