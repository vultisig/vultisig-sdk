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
  PushNotificationRegistration,
  RegisterDeviceOptions,
  SigningNotification,
} from '../types/notifications'

const STORAGE_KEY = 'pushNotificationRegistrations'

type RegistrationMap = Record<string, PushNotificationRegistration>

export class PushNotificationService {
  private readonly handlers: Set<(notification: SigningNotification) => void> = new Set()

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
        device_type: opts.deviceType,
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
   * Remove local registration record for a vault.
   */
  async unregisterVault(vaultId: string): Promise<void> {
    const registrations = await this.getRegistrations()
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
    if (response.status === 204) return false
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
