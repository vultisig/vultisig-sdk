/**
 * In-process mock of the Vultisig notification HTTP + WebSocket API for E2E tests.
 * Mirrors ../notification routes: /ping, /register, /unregister, /vault/:id, /notify, /vapid-public-key, /ws
 */

import http from 'node:http'
import type { AddressInfo } from 'node:net'

import { WebSocket as NodeWebSocket, WebSocketServer } from 'ws'

type RegisteredDevice = {
  vaultId: string
  partyName: string
  token: string
  deviceType: string
}

type TrackedSocket = { ws: NodeWebSocket; vaultId: string }

export class MockNotificationServer {
  private httpServer: http.Server | null = null
  private wss: WebSocketServer | null = null
  private devices: RegisteredDevice[] = []
  private sockets: TrackedSocket[] = []
  private notificationSeq = 0

  /** Last POST /notify bodies (most recent last) */
  readonly notifyLog: Record<string, unknown>[] = []
  /** Last POST /register bodies */
  readonly registerLog: Record<string, unknown>[] = []
  /** Parsed client ACK messages */
  readonly ackLog: Array<{ id: string }> = []

  readonly vapidPublicKey = 'BNmock-e2e-vapid-public-key-for-sdk-notification-tests'

  /** Reset devices, close client sockets, clear logs. Keeps HTTP/WS server listening. */
  clearState(): void {
    for (const { ws } of [...this.sockets]) {
      try {
        ws.terminate()
      } catch {
        /* ignore */
      }
    }
    this.sockets = []
    this.devices = []
    this.notificationSeq = 0
    this.notifyLog.length = 0
    this.registerLog.length = 0
    this.ackLog.length = 0
  }

  async start(): Promise<void> {
    if (this.httpServer) return

    const httpServer = http.createServer((req, res) => {
      void this.handleHttp(req, res).catch(err => {
        if (!res.headersSent) res.writeHead(500).end(String(err))
      })
    })

    const wss = new WebSocketServer({ noServer: true })
    this.wss = wss

    wss.on('connection', (ws: NodeWebSocket, request: http.IncomingMessage) => {
      const url = new URL(request.url ?? '/', 'http://localhost')
      const vaultId = url.searchParams.get('vault_id') ?? ''
      const partyName = url.searchParams.get('party_name') ?? ''
      const token = url.searchParams.get('token') ?? ''
      if (!vaultId || !partyName || !token) {
        ws.close(1008, 'missing query params')
        return
      }
      const authorized = this.devices.some(d => d.vaultId === vaultId && d.partyName === partyName && d.token === token)
      if (!authorized) {
        ws.close(1008, 'unauthorized')
        return
      }
      const entry: TrackedSocket = { ws, vaultId }
      this.sockets.push(entry)
      ws.on('close', () => {
        const i = this.sockets.indexOf(entry)
        if (i !== -1) this.sockets.splice(i, 1)
      })
      ws.on('message', data => {
        try {
          const msg = JSON.parse(String(data)) as { type?: string; id?: string }
          if (msg.type === 'ack' && typeof msg.id === 'string') {
            this.ackLog.push({ id: msg.id })
          }
        } catch {
          // ignore malformed
        }
      })
    })

    httpServer.on('upgrade', (request, socket, head) => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
      if (pathname !== '/ws') {
        socket.destroy()
        return
      }
      wss.handleUpgrade(request, socket, head, ws => {
        wss.emit('connection', ws, request)
      })
    })

    await new Promise<void>((resolve, reject) => {
      httpServer.listen(0, '127.0.0.1', () => resolve())
      httpServer.once('error', reject)
    })

    this.httpServer = httpServer
  }

  get baseUrl(): string {
    const addr = this.httpServer?.address() as AddressInfo | string | null | undefined
    if (!addr || typeof addr === 'string') throw new Error('MockNotificationServer: call start() first')
    return `http://127.0.0.1:${addr.port}`
  }

  async stop(): Promise<void> {
    this.clearState()
    await new Promise<void>(resolve => {
      this.wss?.close(() => resolve())
      if (!this.wss) resolve()
    })
    this.wss = null
    await new Promise<void>((resolve, reject) => {
      this.httpServer?.close(err => (err ? reject(err) : resolve()))
      if (!this.httpServer) resolve()
    })
    this.httpServer = null
  }

  /** Abruptly drop all WebSocket connections for a vault (client should reconnect). */
  terminateVaultSockets(vaultId: string): void {
    for (const { ws, vaultId: v } of [...this.sockets]) {
      if (v === vaultId) ws.terminate()
    }
  }

  private readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', c => chunks.push(c))
      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8')
          resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {})
        } catch (e) {
          reject(e)
        }
      })
      req.on('error', reject)
    })
  }

  private async handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')

    if (req.method === 'GET' && url.pathname === '/ping') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('Vultisig notification server is running')
      return
    }

    if (req.method === 'GET' && url.pathname === '/vapid-public-key') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ public_key: this.vapidPublicKey }))
      return
    }

    const vaultPathMatch = url.pathname.match(/^\/vault\/([^/]+)\/?$/)
    if (req.method === 'GET' && vaultPathMatch) {
      const vaultId = decodeURIComponent(vaultPathMatch[1])
      if (this.devices.some(d => d.vaultId === vaultId)) {
        res.writeHead(200).end()
      } else {
        res.writeHead(404).end()
      }
      return
    }

    if (req.method === 'POST' && url.pathname === '/register') {
      const body = await this.readJsonBody(req)
      this.registerLog.push(body)
      this.devices.push({
        vaultId: String(body.vault_id),
        partyName: String(body.party_name),
        token: String(body.token),
        deviceType: String(body.device_type),
      })
      res.writeHead(200).end()
      return
    }

    if (req.method === 'DELETE' && url.pathname === '/unregister') {
      const body = await this.readJsonBody(req)
      const vaultId = body.vault_id
      const partyName = body.party_name
      const token = body.token
      if (typeof vaultId !== 'string' || typeof partyName !== 'string' || !vaultId || !partyName) {
        res.writeHead(400).end()
        return
      }
      if (typeof token === 'string' && token.length > 0) {
        this.devices = this.devices.filter(
          d => !(d.vaultId === vaultId && d.partyName === partyName && d.token === token)
        )
      } else {
        this.devices = this.devices.filter(d => !(d.vaultId === vaultId && d.partyName === partyName))
      }
      res.writeHead(200).end()
      return
    }

    if (req.method === 'POST' && url.pathname === '/notify') {
      const body = await this.readJsonBody(req)
      this.notifyLog.push(body)
      const vaultId = String(body.vault_id)
      this.notificationSeq += 1
      const id = `${Date.now()}-${this.notificationSeq}`
      const payload = {
        type: 'notification',
        id,
        vault_name: String(body.vault_name),
        qr_code_data: String(body.qr_code_data),
      }
      const msg = JSON.stringify(payload)
      for (const { ws, vaultId: v } of this.sockets) {
        if (v === vaultId && ws.readyState === NodeWebSocket.OPEN) {
          ws.send(msg)
        }
      }
      res.writeHead(200).end()
      return
    }

    res.writeHead(404).end()
  }
}
