function log(msg, cls) {
  const el = document.getElementById('log')
  const line = document.createElement('div')
  if (cls) line.className = cls
  line.textContent = `[${new Date().toISOString()}] ${msg}`
  el.appendChild(line)
}

function postClickAck() {
  void fetch('/ack?evt=click', { method: 'POST' })
}

/**
 * Always-visible proof the push reached the page (OS toasts can be suppressed when Chrome is focused on macOS).
 */
function showInPagePushBanner(d) {
  const panel = document.getElementById('push-received-panel')
  const titleEl = document.getElementById('push-received-title')
  const bodyEl = document.getElementById('push-received-body')
  const hintEl = document.getElementById('push-received-hint')
  if (!panel || !titleEl || !bodyEl || !hintEl) return

  const title = d.title || 'Vultisig'
  const bodyText = typeof d.bodyText === 'string' ? d.bodyText : title
  titleEl.textContent = title
  bodyEl.textContent = bodyText
  const vis = document.visibilityState
  const swLine = d.shown
    ? 'Service worker: showNotification() completed without error.'
    : 'Service worker: showNotification() did not complete successfully — check DevTools → Application → Service Workers.'
  hintEl.textContent = `${swLine} document.visibilityState=${vis}. On macOS, Desktop banners are often skipped while Chrome is the focused app — switch to Finder, then send again to test the OS toast.`
  panel.classList.add('visible')
  document.body.classList.add('has-fixed-push-alert')
  window.setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
}

document.getElementById('btn-ack-inpage')?.addEventListener('click', () => {
  document.getElementById('push-received-panel')?.classList.remove('visible')
  document.body.classList.remove('has-fixed-push-alert')
  postClickAck()
  log('In-page acknowledge sent (same as clicking a system notification).', 'warn')
})

/**
 * Second notification from the visible page (macOS often hides SW banners when the window has focus).
 */
function showPageNotificationFallback(d) {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    log('Page Notification() skipped: API missing or permission not granted.', 'warn')
    return
  }
  try {
    const body = typeof d.bodyText === 'string' ? d.bodyText : d.title
    const n = new Notification(d.title || 'Vultisig', {
      body,
      icon: 'https://vultisig.com/favicon.ico',
      tag: `vultisig-page-fallback-${Date.now()}`,
      requireInteraction: true,
      silent: false,
      renotify: true,
    })
    log(
      'Page Notification() constructed (no throw). If you still see no OS UI, Chrome was likely focused — switch to another app and retry, or use the purple bar + Acknowledge button.',
      'warn'
    )
    n.onclick = () => {
      n.close()
      postClickAck()
    }
  } catch (e) {
    log(`Page Notification() fallback failed: ${e?.message || e}`, 'warn')
  }
}

/** Service worker reports when a push was processed (and whether showNotification succeeded). */
navigator.serviceWorker?.addEventListener('message', ev => {
  const d = ev.data
  if (!d || d.type !== 'vultisig-push-handled') return
  if (d.shown) {
    log('Service worker called showNotification().', 'warn')
  } else {
    log('Service worker did not show a notification (see DevTools → Application → Service Workers).', 'warn')
  }
  if (d.hint) log(d.hint, 'warn')
  showInPagePushBanner(d)
  log(
    'Purple top bar = push handled in-page (always visible). Also trying OS page Notification() — may be invisible if Chrome is focused.',
    'warn'
  )
  showPageNotificationFallback(d)
})

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

async function getConfig() {
  const r = await fetch('/config')
  if (!r.ok) throw new Error('config failed')
  return r.json()
}

document.getElementById('btn-reg').addEventListener('click', async () => {
  const btnReg = document.getElementById('btn-reg')
  const btnSend = document.getElementById('btn-send')
  const btnTestOs = document.getElementById('btn-test-os')
  btnReg.disabled = true
  try {
    const cfg = await getConfig()
    log(`vault_id prefix: ${cfg.vaultId.slice(0, 12)}… party: ${cfg.browserPartyName}`)

    // Bump cache when sw.js changes so Chrome picks up fixes without a manual “Update on reload”.
    const reg = await navigator.serviceWorker.register('/sw.js?v=7', { scope: '/' })
    await navigator.serviceWorker.ready
    log('Service worker active')

    const perm = await Notification.requestPermission()
    if (perm !== 'granted') {
      log('Notification permission denied — allow notifications and retry', 'warn')
      btnReg.disabled = false
      return
    }

    const vapidRes = await fetch('/api/vapid-public-key')
    if (!vapidRes.ok) throw new Error('VAPID fetch failed')
    const { public_key: vapidKey } = await vapidRes.json()
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    })

    const regRes = await fetch('/api/register-browser', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    })
    if (!regRes.ok) {
      const t = await regRes.text()
      throw new Error(`register-browser failed: ${regRes.status} ${t}`)
    }
    log('Registered on notification server (device_type: web)')
    btnSend.disabled = false
    if (btnTestOs) btnTestOs.disabled = false
  } catch (e) {
    log(String(e?.message || e), 'warn')
    btnReg.disabled = false
  }
})

document.getElementById('btn-test-os')?.addEventListener('click', () => {
  if (!('Notification' in window)) {
    log('Notifications API not available in this context.', 'warn')
    return
  }
  if (Notification.permission !== 'granted') {
    log('Complete step 1 first (notification permission must be granted).', 'warn')
    return
  }
  try {
    const n = new Notification('Vultisig harness — OS notification test', {
      body: 'If this never appears: switch to Finder (blur Chrome), enable Notification Centre + Persistent for Chrome in System Settings, and check Focus / Do Not Disturb.',
      icon: 'https://vultisig.com/favicon.ico',
      tag: `harness-os-test-${Date.now()}`,
      requireInteraction: true,
      silent: false,
      renotify: true,
    })
    log(
      'OS test: Notification() returned. If no toast, Chrome was likely the focused app — click Finder then look for the notification.',
      'warn'
    )
    n.onclick = () => n.close()
  } catch (e) {
    log(`OS test failed: ${e?.message || e}`, 'warn')
  }
})

document.getElementById('btn-send').addEventListener('click', async () => {
  const btnSend = document.getElementById('btn-send')
  btnSend.disabled = true
  try {
    const res = await fetch('/api/trigger-notify', { method: 'POST' })
    if (!res.ok) {
      const t = await res.text()
      throw new Error(`trigger-notify failed: ${res.status} ${t}`)
    }
    log('Notify queued — default exit is service-worker push ack (see terminal); WebSocket line is diagnostic.')
    log('Server dedup: wait ~30s before sending again if no new push arrives.', 'warn')
    btnSend.disabled = false

    const doneEl = document.getElementById('e2e-ws-done')
    const poll = async () => {
      const start = Date.now()
      const maxMs = 90_000
      while (Date.now() - start < maxMs) {
        try {
          const r = await fetch('/api/verification')
          if (r.ok) {
            const v = await r.json()
            if (v.pushAck || v.wsReceived) {
              doneEl?.classList.add('visible')
              if (v.pushAck) {
                log('Server reports service worker push ack — Web Push handler ran (see terminal).', 'warn')
              }
              if (v.wsReceived) {
                log('Server reports WebSocket signing payload in Node (diagnostic).', 'warn')
              }
              return
            }
          }
        } catch {
          /* ignore */
        }
        await new Promise(res => setTimeout(res, 500))
      }
      log(
        'No WebSocket confirmation within 90s — check terminal, firewall, or wait 30s after prior notify (dedup).',
        'warn'
      )
    }
    void poll()
  } catch (e) {
    log(String(e?.message || e), 'warn')
    btnSend.disabled = false
  }
})
