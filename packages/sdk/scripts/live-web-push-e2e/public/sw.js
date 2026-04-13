/* global clients */
/**
 * Service worker: show OS notification from Web Push payload (same shape as Vultisig server),
 * then report push + click to the local verifier server.
 *
 * macOS + Chrome: with Notification Centre enabled + Persistent alerts, requireInteraction helps the toast stay
 * visible; the page also shows a fixed in-page banner (see app.js) because focused Chrome often gets no Desktop banner.
 */
const NOTIF_ICON = 'https://vultisig.com/favicon.ico'

self.addEventListener('push', event => {
  event.waitUntil(
    (async () => {
      let data = { title: 'Vultisig', subtitle: 'Vault: ?', body: '?' }
      if (event.data) {
        try {
          const text = await event.data.text()
          const parsed = JSON.parse(text)
          if (parsed && typeof parsed === 'object') {
            data = parsed
          }
        } catch {
          /* keep defaults */
        }
      }

      const title = data.title || 'Vultisig'
      const bodyLine = [data.subtitle, data.body].filter(Boolean).join('\n')
      const tag = `vultisig-sdk-e2e-${Date.now()}`

      let shown = false
      try {
        await self.registration.showNotification(title, {
          body: bodyLine || 'Keysign request',
          tag,
          icon: NOTIF_ICON,
          badge: NOTIF_ICON,
          silent: false,
          renotify: true,
          requireInteraction: true,
        })
        shown = true
      } catch (e) {
        console.error('[sw] showNotification failed', e)
      }

      try {
        await fetch(new URL('/ack?evt=push', self.location.origin), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            swShowNotificationOk: shown,
          }),
        })
      } catch {
        /* recorder down */
      }

      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of clientsList) {
        client.postMessage({
          type: 'vultisig-push-handled',
          shown,
          title,
          bodyText: bodyLine || 'Keysign request',
          hint: 'macOS: Enable Notification Centre + Persistent for Chrome; if Chrome is the focused app you may still get no Desktop banner — switch to Finder. A purple in-page bar should always appear for this harness.',
        })
      }
    })()
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      try {
        await fetch(new URL('/ack?evt=click', self.location.origin), { method: 'POST' })
      } catch {
        /* recorder down */
      }
      const all = await clients.matchAll({ type: 'window', includeUncontrolled: true })
      if (all.length > 0) {
        await all[0].focus()
      }
    })()
  )
})
