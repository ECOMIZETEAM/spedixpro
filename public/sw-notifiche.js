// LE NOTIFICHE DEL BROWSER (calendario, fase 3, 26/11/2026). Fa solo due cose: mostra la notifica che arriva dal
// server (lib/notifiche-push) e, al clic, porta alla pagina giusta — in una scheda del portale già aperta se c'è.
// Non tiene niente in memoria e non intercetta le pagine (niente cache, niente fetch): il portale resta com'era.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (evento) => {
  let n = {}
  try { n = evento.data ? evento.data.json() : {} } catch (e) { n = { titolo: 'MoovExpress', testo: evento.data ? evento.data.text() : '' } }
  const titolo = n.titolo || 'MoovExpress'
  evento.waitUntil(self.registration.showNotification(titolo, {
    body: n.testo || '',
    icon: '/icon.png',
    badge: '/icon.png',
    // la stessa voce non si accumula: la nuova sostituisce la vecchia
    tag: n.chiave || undefined,
    renotify: !!n.chiave,
    data: { link: n.link || '/dashboard/calendario' },
  }))
})

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close()
  const link = new URL((evento.notification.data && evento.notification.data.link) || '/', self.location.origin).href
  evento.waitUntil((async () => {
    const schede = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const s of schede) {
      if (new URL(s.url).origin === self.location.origin && 'focus' in s) {
        await s.focus()
        if ('navigate' in s) { try { await s.navigate(link) } catch (e) { /* scheda di un'altra origine o chiusa */ } }
        return
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(link)
  })())
})
