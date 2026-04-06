/**
 * Local helper: live notification API + browser Web Push + optional Node WebSocket listener.
 *
 * **Product bar (extension parity):** a **visible** OS/browser notification the user can see and click.
 * macOS + Chrome often hides banners unless System Settings → Notifications → Chrome are configured;
 * this harness also triggers a **page-level** `Notification()` fallback you can click.
 *
 * **Automation / agents:** OS notification UI is **not** visible to Playwright or CDP. Poll
 * `GET /api/verification` for `pushAck` (service worker ran the push handler and called
 * `showNotification` or recorded failure) and optionally `wsReceived` (signing payload over `wss`).
 *
 * Run from repo: `yarn workspace @vultisig/sdk live-push-e2e`
 *
 * Env:
 * - PUSH_E2E_SUCCESS — `push` (default) | `click` | `ws` — what makes the helper exit successfully (see README)
 * - PUSH_E2E_VAULT_ID — 64-char lowercase hex (or set ECDSA + chain below)
 * - PUSH_E2E_ECDSA_HEX + PUSH_E2E_HEX_CHAIN_CODE — derive vault_id with computeNotificationVaultId
 * - TEST_VAULT_PATH + TEST_VAULT_PASSWORD — load .vult (same as E2E tests); vault_id derived automatically
 * - PUSH_E2E_VAULT_NAME — shown in notification subtitle (overrides vault name when loading from file)
 * - NOTIFICATION_URL — default https://api.vultisig.com/notification (same as iOS Endpoint.vultisigNotification)
 */
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

import { config as loadEnv } from 'dotenv'

import { PushNotificationService } from '../../src/services/PushNotificationService'
import { MemoryStorage } from '../../src/storage/MemoryStorage'
import { computeNotificationVaultId } from '../../src/utils/computeNotificationVaultId'
import type { Vultisig } from '../../src/Vultisig'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = join(scriptDir, 'public')

const SENDER_PARTY = 'sdk-live-e2e-sender'

function loadDotenv(): void {
  const e2eEnv = join(scriptDir, '../../tests/e2e/.env')
  loadEnv({ path: e2eEnv })
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

type ResolvedVault = {
  vaultId: string
  /** Shown in push subtitle (`vault_name` in /notify) */
  notifyVaultName: string
  sdk: Vultisig | null
}

async function resolveVault(): Promise<ResolvedVault> {
  const nameOverride = process.env.PUSH_E2E_VAULT_NAME?.trim()

  const direct = process.env.PUSH_E2E_VAULT_ID?.trim().toLowerCase()
  if (direct) {
    if (!/^[0-9a-f]{64}$/.test(direct)) {
      throw new Error('PUSH_E2E_VAULT_ID must be 64 lowercase hex chars (SHA-256 hex)')
    }
    return {
      vaultId: direct,
      notifyVaultName: nameOverride || 'SDK live e2e',
      sdk: null,
    }
  }

  const ecdsa = process.env.PUSH_E2E_ECDSA_HEX?.trim()
  const chain = process.env.PUSH_E2E_HEX_CHAIN_CODE?.trim()
  if (ecdsa && chain) {
    const vaultId = await computeNotificationVaultId(ecdsa, chain)
    return {
      vaultId,
      notifyVaultName: nameOverride || 'SDK live e2e',
      sdk: null,
    }
  }

  const vaultPathRaw = process.env.TEST_VAULT_PATH?.trim()
  const vaultPassword = process.env.TEST_VAULT_PASSWORD?.trim()
  if (vaultPathRaw && vaultPassword) {
    await import('./bootstrap-wasm-for-live-push.js')
    const { loadVaultFromDisk } = await import('./load-vault-from-disk.js')
    const vaultPath = resolvePath(vaultPathRaw)
    console.log('Loading vault for notification vault_id:', vaultPath)
    const { sdk, vault } = await loadVaultFromDisk(vaultPath, vaultPassword)
    const vaultId = await computeNotificationVaultId(vault.publicKeys.ecdsa, vault.hexChainCode)
    return {
      vaultId,
      notifyVaultName: nameOverride || vault.name || 'SDK live e2e',
      sdk,
    }
  }

  throw new Error(
    'Set PUSH_E2E_VAULT_ID, or PUSH_E2E_ECDSA_HEX+PUSH_E2E_HEX_CHAIN_CODE, or TEST_VAULT_PATH+TEST_VAULT_PASSWORD (see tests/e2e/.env)'
  )
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<boolean> {
  const safe = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '')
  if (safe.includes('..')) return false
  const file = join(PUBLIC_DIR, safe)
  try {
    const data = await readFile(file)
    const type = safe.endsWith('.html')
      ? 'text/html'
      : safe.endsWith('.js')
        ? 'application/javascript'
        : 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` })
    res.end(data)
    return true
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  loadDotenv()

  const notificationUrl = (process.env.NOTIFICATION_URL || 'https://api.vultisig.com/notification').replace(/\/$/, '')
  const { vaultId, notifyVaultName, sdk: vaultSdk } = await resolveVault()
  const browserPartyName =
    process.env.PUSH_E2E_BROWSER_PARTY?.trim() || `sdk-live-e2e-browser-${Date.now().toString(36)}`

  const storage = new MemoryStorage()
  const push = new PushNotificationService(storage, notificationUrl)

  const acks = { push: false, click: false }
  const verification = {
    wsReceived: false,
    wsVaultName: '' as string,
    wsQrPrefix: '' as string,
    /** From optional JSON body on POST /ack?evt=push */
    lastPushTitle: '' as string,
    lastSwShowNotificationOk: null as boolean | null,
  }
  let wsToken: string | null = null

  const successMode = (process.env.PUSH_E2E_SUCCESS || 'push').toLowerCase()
  if (!['push', 'click', 'ws'].includes(successMode)) {
    throw new Error('PUSH_E2E_SUCCESS must be one of: push, click, ws')
  }

  push.onSigningRequest(n => {
    verification.wsReceived = true
    verification.wsVaultName = n.vaultName
    verification.wsQrPrefix = n.qrCodeData.slice(0, 64)
    console.log('')
    console.log('📡 Diagnostic: production WebSocket signing payload received in Node')
    console.log(`   Same wss path as Vultisig desktop / extension; proves server + stream, not OS notification UI.`)
    console.log(`   vault_name: ${n.vaultName}`)
    console.log(`   qr_code_data: ${n.qrCodeData.slice(0, 72)}${n.qrCodeData.length > 72 ? '…' : ''}`)
    console.log('')
  })

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')

    try {
      if (req.method === 'POST' && url.pathname === '/ack') {
        const evt = url.searchParams.get('evt')
        if (evt === 'push') {
          acks.push = true
          try {
            const raw = await readBody(req)
            if (raw.trim()) {
              const o = JSON.parse(raw) as { title?: unknown; swShowNotificationOk?: unknown }
              if (typeof o.title === 'string') verification.lastPushTitle = o.title
              if (typeof o.swShowNotificationOk === 'boolean') {
                verification.lastSwShowNotificationOk = o.swShowNotificationOk
              }
            }
          } catch {
            /* ignore malformed body */
          }
        } else if (evt === 'click') {
          acks.click = true
        }
        res.writeHead(204).end()
        return
      }

      if (req.method === 'GET' && url.pathname === '/api/verification') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            pushAck: acks.push,
            clickAck: acks.click,
            wsReceived: verification.wsReceived,
            wsVaultName: verification.wsVaultName,
            wsQrPrefix: verification.wsQrPrefix,
            lastPushTitle: verification.lastPushTitle,
            lastSwShowNotificationOk: verification.lastSwShowNotificationOk,
            wsConnectionState: push.connectionState,
            successMode,
          })
        )
        return
      }

      if (req.method === 'GET' && url.pathname === '/config') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            vaultId,
            notificationUrl,
            browserPartyName,
          })
        )
        return
      }

      /** Same-origin VAPID fetch (avoids browser CORS / wrong base URL issues) */
      if (req.method === 'GET' && url.pathname === '/api/vapid-public-key') {
        const r = await fetch(`${notificationUrl}/vapid-public-key`)
        const text = await r.text()
        const ct = r.headers.get('content-type') || 'application/json'
        res.writeHead(r.status, { 'Content-Type': ct })
        res.end(text)
        return
      }

      if (req.method === 'POST' && url.pathname === '/api/register-browser') {
        const raw = await readBody(req)
        const body = JSON.parse(raw) as { subscription?: { endpoint: string; keys?: { p256dh: string; auth: string } } }
        if (!body.subscription?.endpoint) {
          res.writeHead(400).end('missing subscription')
          return
        }
        const token = JSON.stringify(body.subscription)
        await push.registerDevice({
          vaultId,
          partyName: browserPartyName,
          token,
          deviceType: 'web',
        })
        if (wsToken !== token) {
          push.disconnect()
          push.connect({ vaultId, partyName: browserPartyName, token })
          wsToken = token
          console.log('Node: connected WebSocket for live verification (same token as browser registration).')
        }
        res.writeHead(200).end('ok')
        return
      }

      if (req.method === 'POST' && url.pathname === '/api/trigger-notify') {
        await push.notifyVaultMembers({
          vaultId,
          vaultName: notifyVaultName,
          localPartyId: SENDER_PARTY,
          qrCodeData: `sdk-live-e2e:${Date.now()}`,
        })
        res.writeHead(200).end('ok')
        return
      }

      if (req.method === 'GET') {
        const ok = await serveStatic(url.pathname, res)
        if (ok) return
      }

      res.writeHead(404).end('not found')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!res.headersSent) res.writeHead(500).end(msg)
    }
  })

  const port = Number(process.env.PUSH_E2E_PORT || '0') || 0
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve))
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('listen failed')
  const actualPort = addr.port
  const origin = `http://127.0.0.1:${actualPort}`

  console.log('')
  console.log('=== Vultisig SDK — live Web Push E2E ===')
  console.log(`Open in Chrome/Edge: ${origin}`)
  console.log(`Notification API:    ${notificationUrl}`)
  console.log(`vault_id:            ${vaultId}`)
  console.log(`Browser party:       ${browserPartyName}`)
  console.log(`Sender party:        ${SENDER_PARTY} (excluded from notify — you still receive push)`)
  console.log(`Success mode:        ${successMode} (PUSH_E2E_SUCCESS=push|click|ws — see README)`)
  console.log('')
  console.log('Steps:')
  console.log('  1. Open the URL, click “Register…”, allow notifications (needed for Web Push in the browser).')
  console.log('  2. Click “Send test notification”.')
  console.log('  3. Product check: you should see an OS or in-page notification; click it (mode: click).')
  console.log(
    '  4. Default mode (push): helper exits when the service worker reports the push (poll GET /api/verification).'
  )
  console.log('     WebSocket lines above are diagnostic only unless PUSH_E2E_SUCCESS=ws.')
  console.log('Press Ctrl+C to stop and unregister this browser from the server.')
  console.log('')

  const shutdown = async (exitCode = 0) => {
    push.disconnect()
    console.log('\nUnregistering from notification server…')
    try {
      await push.unregisterVault(vaultId)
      console.log('Unregistered.')
    } catch (e) {
      console.warn('Unregister failed (you may have stale registration):', e)
    }
    vaultSdk?.dispose()
    server.close()
    process.exit(exitCode)
  }
  process.on('SIGINT', () => void shutdown(0))
  process.on('SIGTERM', () => void shutdown(0))

  const deadline = Date.now() + (Number(process.env.PUSH_E2E_WAIT_MS) || 600_000)

  const printPushSuccess = () => {
    console.log('')
    console.log('✅ Web Push reached the service worker (push ack).')
    if (verification.lastSwShowNotificationOk === true) {
      console.log('   Service worker reports showNotification() succeeded (OS UI may still be hidden on macOS).')
    } else if (verification.lastSwShowNotificationOk === false) {
      console.log(
        '   Service worker reports showNotification() failed — check DevTools → Application → Service Workers.'
      )
    }
    if (verification.lastPushTitle) {
      console.log(`   Title: ${verification.lastPushTitle}`)
    }
    console.log('   For stakeholder-visible verification: confirm a banner or Notification Centre entry (see README).')
    console.log('')
  }

  await new Promise<void>(resolve => {
    const t = setInterval(() => {
      const doneWs = successMode === 'ws' && verification.wsReceived
      const donePush = successMode === 'push' && acks.push

      const clickCompletes =
        (successMode === 'click' && acks.click) || (successMode === 'push' && acks.click && acks.push)

      if (clickCompletes) {
        clearInterval(t)
        console.log('')
        console.log('✅ NOTIFICATION CLICK ACK — full UI path (OS or page fallback notification).')
        if (acks.push) {
          console.log('✅ Push event reached the service worker.')
        }
        if (verification.wsReceived) {
          console.log('✅ Diagnostic: WebSocket signing payload was also received in Node.')
        }
        console.log('')
        void shutdown(0)
        resolve()
        return
      }

      if (donePush) {
        clearInterval(t)
        printPushSuccess()
        if (verification.wsReceived) {
          console.log('✅ Diagnostic: WebSocket signing payload received in Node.')
        }
        void shutdown(0)
        resolve()
        return
      }

      if (doneWs) {
        clearInterval(t)
        console.log('')
        console.log(
          '✅ PUSH_E2E_SUCCESS=ws — exiting on WebSocket only (diagnostic; not sufficient for visible-notification sign-off).'
        )
        console.log('')
        void shutdown(0)
        resolve()
        return
      }

      if (Date.now() > deadline) {
        clearInterval(t)
        const hint =
          successMode === 'click'
            ? 'Timed out waiting for notification click. Try macOS Chrome notification settings, click the page fallback notification, or run with PUSH_E2E_SUCCESS=push to assert service-worker delivery only.'
            : successMode === 'push'
              ? 'Timed out waiting for service worker push ack. Check network, wait ~30s after last notify (dedup), and see README.'
              : 'Timed out waiting for WebSocket payload (PUSH_E2E_SUCCESS=ws). Check network and dedup window.'
        console.error(hint)
        void shutdown(1)
        resolve()
      }
    }, 400)
  })
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
