import { sha256 } from '@noble/hashes/sha2'

/**
 * Computes the `vault_id` used by the notification server, matching iOS:
 * SHA256(utf8(pubKeyECDSA + hexChainCode)) as lowercase hex.
 */
export async function computeNotificationVaultId(pubKeyECDSA: string, hexChainCode: string): Promise<string> {
  const data = new TextEncoder().encode(pubKeyECDSA + hexChainCode)
  const digest = sha256(data)
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('')
}
