/**
 * PushNotificationService — Platform-agnostic push notification service for vault signing coordination
 *
 * Handles device registration, notification sending, and incoming push parsing.
 * Push token acquisition and platform push handlers are the consumer's responsibility.
 */

import type { Storage } from '../storage/types'
import type {
  NotificationPayload,
  NotifyVaultMembersOptions,
  PushDeviceType,
  PushNotificationRegistration,
  RegisterDeviceOptions,
  SigningNotification,
  WSConnectionState,
  WSConnectOptions,
} from '../types/notifications'

const STORAGE_KEY = 'pushNotificationRegistrations'

/** Maps SDK device types to values the notification server accepts (`apple` | `android` | `web`). */
function toServerDeviceType(deviceType: PushDeviceType): 'apple' | 'android' | 'web' {
  if (deviceType === 'ios') return 'apple'
  if (deviceType === 'electron') return 'web'
  return deviceType
}

type RegistrationMap = Record<string, PushNotificationRegistration>

/** Max reconnection delay in milliseconds */
const MAX_RECONNECT_DELAY = 30_000

export class PushNotificationService {
  private readonly handlers: Set<(notification: SigningNotification) => void> = new Set()

  // WebSocket state
  private ws: WebSocket | null = null
  private wsState: WSConnectionState = 'disconnected'
  private wsOptions: WSConnectOptions | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private readonly stateHandlers: Set<(state: WSConnectionState) => void> = new Set()

  constructor(
    private readonly storage: Storage,
    private readonly serverUrl: string
  ) {}

  // ===== Step 1: Registration =====

  /**
   * Fetch the VAPID public key for Web Push subscriptions.
   * Only needed for `deviceType: 'web'` consumers.
   */
  async fetchVapidPublicKey(): Promise<string> {
    const response = await fetch(`${this.serverUrl}/vapid-public-key`)
    if (!response.ok) {
      throw new Error(`Failed to fetch VAPID public key: ${response.status} ${response.statusText}`)
    }
    const data: { public_key: string } = await response.json()
    return data.public_key
  }

  /**
   * Register a device to receive push notifications for a vault.
   * Sends registration to the server and persists it locally.
   */
  async registerDevice(opts: RegisterDeviceOptions): Promise<void> {
    const response = await fetch(`${this.serverUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vault_id: opts.vaultId,
        party_name: opts.partyName,
        token: opts.token,
        device_type: toServerDeviceType(opts.deviceType),
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to register device: ${response.status} ${response.statusText}`)
    }

    // Persist locally
    const registrations = await this.getRegistrations()
    registrations[opts.vaultId] = {
      vaultId: opts.vaultId,
      partyName: opts.partyName,
      registeredAt: Date.now(),
    }
    await this.storage.set(STORAGE_KEY, registrations)
  }

  /**
   * Unregister from the notification server (when a local record exists) and remove local storage.
   * Server call uses `vault_id` + `party_name` from the persisted registration; `token` is omitted
   * so the server removes all devices for that party (see notification API).
   *
   * If there is no local registration, this is a no-op (server is not contacted). On non-OK HTTP
   * responses, local state is left unchanged so the caller can retry.
   */
  async unregisterVault(vaultId: string): Promise<void> {
    const registrations = await this.getRegistrations()
    const reg = registrations[vaultId]
    if (reg) {
      const response = await fetch(`${this.serverUrl}/unregister`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vault_id: vaultId,
          party_name: reg.partyName,
        }),
      })
      if (!response.ok) {
        throw new Error(`Failed to unregister from notification server: ${response.status} ${response.statusText}`)
      }
    }

    delete registrations[vaultId]
    if (Object.keys(registrations).length === 0) {
      await this.storage.remove(STORAGE_KEY)
    } else {
      await this.storage.set(STORAGE_KEY, registrations)
    }
  }

  /**
   * Check if a vault is registered locally for push notifications.
   */
  async isVaultRegistered(vaultId: string): Promise<boolean> {
    const registrations = await this.getRegistrations()
    return vaultId in registrations
  }

  /**
   * Check if any devices are registered for a vault on the server.
   * Returns true if at least one device is registered.
   */
  async hasRemoteRegistrations(vaultId: string): Promise<boolean> {
    const response = await fetch(`${this.serverUrl}/vault/${encodeURIComponent(vaultId)}`)
    if (response.status === 200) return true
    // 404 is the current server contract; 204 kept for older proxies or pre-fix deployments
    if (response.status === 404 || response.status === 204) return false
    throw new Error(`Failed to check vault registrations: ${response.status} ${response.statusText}`)
  }

  /**
   * Get all locally tracked registration records.
   */
  async getRegistrations(): Promise<RegistrationMap> {
    return (await this.storage.get<RegistrationMap>(STORAGE_KEY)) ?? {}
  }

  // ===== Step 2: Notify =====

  /**
   * Send a push notification to all other registered devices for a vault.
   * The notification contains keysign QR data so recipients can join the signing session.
   *
   * Note: The server deduplicates notifications per vault_id (30-second window).
   */
  async notifyVaultMembers(opts: NotifyVaultMembersOptions): Promise<void> {
    const response = await fetch(`${this.serverUrl}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vault_id: opts.vaultId,
        vault_name: opts.vaultName,
        local_party_id: opts.localPartyId,
        qr_code_data: opts.qrCodeData,
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to notify vault members: ${response.status} ${response.statusText}`)
    }
  }

  // ===== Step 3: Receive =====

  /**
   * Register a callback for incoming signing request notifications.
   * Returns an unsubscribe function.
   *
   * Consumer must call `handleIncomingPush(data)` from their platform's push handler
   * to trigger registered callbacks.
   */
  onSigningRequest(handler: (notification: SigningNotification) => void): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  /**
   * Process an incoming push notification from a platform push handler.
   * Parses the payload and invokes all registered `onSigningRequest` callbacks.
   *
   * Call this from your platform's push event handler:
   * - iOS: `UNUserNotificationCenter` delegate
   * - Android: `FirebaseMessagingService.onMessageReceived`
   * - Browser/Extension: Service worker `push` event
   * - Electron: Web Push or FCM via main process
   */
  handleIncomingPush(data: unknown): void {
    const notification = this.parseNotificationPayload(data)
    if (!notification) return

    for (const handler of this.handlers) {
      handler(notification)
    }
  }

  /**
   * Parse raw push notification data into a typed SigningNotification.
   * Returns null if the data doesn't match the expected format.
   *
   * Use this for manual control instead of the callback-based `handleIncomingPush`.
   */
  parseNotificationPayload(data: unknown): SigningNotification | null {
    if (!data || typeof data !== 'object') return null

    const payload = data as Record<string, unknown>
    const title = payload.title
    const subtitle = payload.subtitle
    const body = payload.body

    if (typeof title !== 'string' || typeof subtitle !== 'string' || typeof body !== 'string') {
      return null
    }

    const raw: NotificationPayload = { title, subtitle, body }

    // The server sends: title="Vultisig Keysign request", subtitle="Vault: {name}", body="{qr_code_data}"
    const vaultName = subtitle.startsWith('Vault: ') ? subtitle.slice(7) : subtitle

    return {
      vaultName,
      qrCodeData: body,
      raw,
    }
  }

  // ===== WebSocket =====

  /**
   * Derive the WebSocket URL from the REST server URL.
   * e.g. "https://api.vultisig.com/notification" → "wss://api.vultisig.com/notification/ws"
   */
  private get wsUrl(): string {
    const url = new URL(this.serverUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    // Ensure path ends with /ws
    url.pathname = url.pathname.replace(/\/$/, '') + '/ws'
    return url.toString()
  }

  /**
   * Connect a WebSocket for real-time notification delivery.
   * Messages are delivered through the same onSigningRequest() callbacks.
   *
   * Requires prior registerDevice() call — the server validates the token.
   * Auto-reconnects on disconnection (server re-delivers pending messages within 60s TTL).
   */
  connect(options: WSConnectOptions): void {
    this.disconnect()
    this.wsOptions = options
    this.reconnectAttempts = 0
    this.openWebSocket()
  }

  /**
   * Disconnect the WebSocket and stop auto-reconnect.
   */
  disconnect(): void {
    if (this.wsOptions === null && !this.ws) return
    this.wsOptions = null // Signal intentional disconnect
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      // Detach onclose before closing to prevent the onclose handler from
      // triggering reconnect or redundant state change
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    }
    this.setWSState('disconnected')
  }

  /**
   * Current WebSocket connection state.
   */
  get connectionState(): WSConnectionState {
    return this.wsState
  }

  /**
   * Register a callback for connection state changes.
   * Returns an unsubscribe function.
   */
  onConnectionStateChange(handler: (state: WSConnectionState) => void): () => void {
    this.stateHandlers.add(handler)
    return () => {
      this.stateHandlers.delete(handler)
    }
  }

  private setWSState(state: WSConnectionState): void {
    this.wsState = state
    for (const handler of this.stateHandlers) {
      handler(state)
    }
  }

  private openWebSocket(): void {
    this.setWSState('connecting')

    const params = new URLSearchParams({
      vault_id: this.wsOptions!.vaultId,
      party_name: this.wsOptions!.partyName,
      token: this.wsOptions!.token,
    })

    const ws = new WebSocket(`${this.wsUrl}?${params}`)
    this.ws = ws

    ws.onopen = () => {
      this.reconnectAttempts = 0
      this.setWSState('connected')
    }

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
        if (msg.type === 'notification') {
          const notification: SigningNotification = {
            vaultName: msg.vault_name,
            qrCodeData: msg.qr_code_data,
            raw: {
              title: 'Vultisig Keysign request',
              subtitle: `Vault: ${msg.vault_name}`,
              body: msg.qr_code_data,
            },
          }
          for (const handler of this.handlers) {
            handler(notification)
          }
          // ACK to prevent re-delivery on reconnect
          ws.send(JSON.stringify({ type: 'ack', id: msg.id }))
        }
      } catch {
        // Ignore malformed messages
      }
    }

    ws.onclose = () => {
      this.ws = null
      if (this.wsOptions) {
        // Unintentional disconnect — reconnect
        this.setWSState('reconnecting')
        this.scheduleReconnect()
      } else {
        this.setWSState('disconnected')
      }
    }

    ws.onerror = () => {
      // onclose fires after onerror — reconnect handled there
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), MAX_RECONNECT_DELAY)
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => {
      if (this.wsOptions) {
        this.openWebSocket()
      }
    }, delay)
  }

  // ===== Health =====

  /**
   * Check if the notification server is reachable.
   */
  async ping(): Promise<boolean> {
    try {
      const response = await fetch(`${this.serverUrl}/ping`)
      return response.ok
    } catch {
      return false
    }
  }
}
