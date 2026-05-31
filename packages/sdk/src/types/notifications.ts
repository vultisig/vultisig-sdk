/**
 * Push Notification types for vault signing coordination
 *
 * Enables vault members to register for push notifications and
 * notify each other when signing sessions are initiated.
 */

/** Device push token — opaque string from platform push service (APNs, FCM, Web Push) */
export type PushToken = string

/** Device type for push notification registration */
export type PushDeviceType = 'ios' | 'android' | 'web' | 'electron'

/** Options for registering a device for vault notifications */
export type RegisterDeviceOptions = {
  vaultId: string
  partyName: string
  token: PushToken
  deviceType: PushDeviceType
  /**
   * Bundle id of the app registering (e.g. "money.terra.station" for Station).
   * The notification service routes pushes per app_id, so an app that shares a
   * vault with the regular wallet must register its own appId to receive its
   * pushes (and to avoid being delivered on the wallet's APNs topic). Optional:
   * the regular wallet omits it and the server defaults to the wallet bundle id,
   * so existing registrations are unchanged.
   */
  appId?: string
}

/** Options for sending a notification to vault members */
export type NotifyVaultMembersOptions = {
  vaultId: string
  vaultName: string
  localPartyId: string
  /** The keysign QR code data (session URL/payload) that other devices use to join signing */
  qrCodeData: string
  /**
   * Target app bundle id (see RegisterDeviceOptions.appId). When set, the
   * notification service delivers only to that app's devices for the vault.
   * Omit to keep the server's wallet-default routing.
   */
  appId?: string
}

/** Registration record persisted in SDK storage */
export type PushNotificationRegistration = {
  vaultId: string
  partyName: string
  registeredAt: number
  /** App bundle id this device registered under (see RegisterDeviceOptions.appId).
   *  Persisted so unregister can scope the server delete to the same app. */
  appId?: string
}

/** Incoming push notification payload (from server push event) */
export type NotificationPayload = {
  title: string
  subtitle: string
  body: string
}

/** Parsed signing notification with extracted QR data */
export type SigningNotification = {
  /** The vault name from the notification subtitle */
  vaultName: string
  /** The keysign QR/session data from the notification body */
  qrCodeData: string
  /** Raw notification payload */
  raw: NotificationPayload
}

// ===== WebSocket types =====

/** WebSocket connection lifecycle state */
export type WSConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

/** Options for connecting a WebSocket for real-time notification delivery */
export type WSConnectOptions = {
  vaultId: string
  partyName: string
  /** Same push token used for registerDevice() — server validates it */
  token: string
}
