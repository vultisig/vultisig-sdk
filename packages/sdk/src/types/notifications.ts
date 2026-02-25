/**
 * Push Notification types for vault signing coordination
 *
 * Enables vault members to register for push notifications and
 * notify each other when signing sessions are initiated.
 */

/** Device push token — opaque string from platform push service (APNs, FCM, Web Push) */
export type PushToken = string

/** Device type for push notification registration */
export type PushDeviceType = 'ios' | 'android' | 'web'

/** Options for registering a device for vault notifications */
export type RegisterDeviceOptions = {
  vaultId: string
  partyName: string
  token: PushToken
  deviceType: PushDeviceType
}

/** Options for sending a notification to vault members */
export type NotifyVaultMembersOptions = {
  vaultId: string
  vaultName: string
  localPartyId: string
  /** The keysign QR code data (session URL/payload) that other devices use to join signing */
  qrCodeData: string
}

/** Registration record persisted in SDK storage */
export type PushNotificationRegistration = {
  vaultId: string
  partyName: string
  registeredAt: number
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
