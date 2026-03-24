/**
 * Computes the `vault_id` used by the notification server, matching iOS:
 * SHA256(utf8(pubKeyECDSA + hexChainCode)) as lowercase hex.
 *
 * Requires `globalThis.crypto.subtle` (Node 20+, modern browsers). Polyfill if missing.
 */
export async function computeNotificationVaultId(pubKeyECDSA: string, hexChainCode: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('Web Crypto API (crypto.subtle) is not available')
  }
  const data = new TextEncoder().encode(pubKeyECDSA + hexChainCode)
  const digest = await subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}
