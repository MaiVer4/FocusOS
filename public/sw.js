// FocusOS Service Worker — Soporte de notificaciones en móvil
const CACHE_NAME = 'focusos-v2';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Escuchar mensajes del cliente para mostrar notificaciones
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, options } = event.data;
    const cleanOptions = {
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [150],
      renotify: false,
      ...options,
    };
    event.waitUntil(
      self.registration.showNotification(title, cleanOptions)
    );
  }
});

// Click en la notificación → abrir/enfocar la app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      if (clients.length > 0) {
        return clients[0].focus();
      }
      return self.clients.openWindow('/');
    })
  );
});
