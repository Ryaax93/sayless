// Service worker de SAYLESS STUDIO : affiche les notifications envoyées au fondateur (Web Push).
// Aucune mise en cache : STUDIO affiche toujours des données à jour, jamais une copie hors ligne.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const shown = self.registration.showNotification(String(data.title || 'SAYLESS STUDIO').slice(0, 120), {
    body: String(data.body || '').slice(0, 300), tag: String(data.kind || 'studio'), icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
    data: { url: '/#/notifications' },
  });
  // Essai depuis STUDIO : la notification est affichée, puis sa réception est confirmée au serveur
  // (identifiant de l'essai seulement ; sans session STUDIO valide, la confirmation est refusée).
  const receipt = typeof data.test === 'string' && /^[0-9a-f]{32}$/.test(data.test) && typeof fetch === 'function'
    ? shown.then(() => fetch('/api/admin/push/receipt', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Studio-Request': '1' }, body: JSON.stringify({ test: data.test }) })).catch(() => null)
    : shown;
  event.waitUntil(receipt);
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const client of list) {
      if ('focus' in client) {
        client.navigate?.('/#/notifications');
        return client.focus();
      }
    }
    return self.clients.openWindow('/#/notifications');
  }));
});
