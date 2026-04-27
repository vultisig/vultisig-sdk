/**
 * Fast vault signing orchestrator (RN-safe).
 *
 * Vendored from vultiagent-app/src/services/auth/fastVaultSign.ts. Wraps the
 * SDK's `keysign` with the VultiServer + relay choreography expected by the
 * RN app path. Consumers pass `vultiServerUrl` + `relayUrl` explicitly OR
 * rely on `configureRuntime()` registry defaults.
 *
 * Returns a hex-encoded signature:
 *  - ECDSA: `r (32B) || s (32B) || recovery_id (1B)`
 *  - EdDSA: `r (32B) || s (32B)` (no recovery id)
 */

import { keysign } from '@vultisig/core-mpc/keysign'

import { getConfiguredRelayUrl, getConfiguredVultiServerUrl } from '../runtime'
import { joinRelaySession, startRelaySession, waitForParties } from './relay'

export type FastVaultSignOptions = {
  keyshareBase64: string
  messageHashHex: string
  serverDerivePath: string
  localDerivePath: string
  localPartyId: string
  vaultPassword: string
  publicKeyEcdsa: string
  chain?: string
  isEcdsa?: boolean
  maxAttempts?: number
  /** Override the VultiServer URL configured via configureRuntime / SDK default. */
  vultiServerUrl?: string
  /** Override the relay URL configured via configureRuntime / SDK default. */
  relayUrl?: string
}

const DEFAULT_VULTI_SERVER_URL = 'https://api.vultisig.com/vault'
const DEFAULT_RELAY_URL = 'https://api.vultisig.com/router'

// Exported for unit tests so the missing-crypto fallback (CR item #9) can be
// exercised directly. Not part of the public SDK surface — the
// `INTERNAL_FOR_TESTING` constant naming follows the rest of the SDK's
// test-only export convention.
export const INTERNAL_FOR_TESTING = {
  get randomUUID() {
    return randomUUID
  },
  get randomHex() {
    return randomHex
  },
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  const rng = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => void } }).crypto
  if (!rng?.getRandomValues) {
    throw new Error('globalThis.crypto.getRandomValues not available — install expo-crypto or equivalent polyfill')
  }
  rng.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

function randomUUID(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  // Fallback: derive a v4 UUID from `crypto.getRandomValues` bytes. If
  // neither `crypto.randomUUID` nor `crypto.getRandomValues` is wired up,
  // throw consistently with `randomHex` rather than silently emitting a
  // UUID derived from an all-zero buffer (collision risk → server-side
  // session reuse → cross-tenant signing surface). Hermes RN ships
  // `crypto.getRandomValues` via expo-crypto in production, but a
  // misconfigured embedder could miss it.
  const rng = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => void } }).crypto
  if (!rng?.getRandomValues) {
    throw new Error('globalThis.crypto.getRandomValues not available — install expo-crypto or equivalent polyfill')
  }
  const b = new Uint8Array(16)
  rng.getRandomValues(b)
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const hex = Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/**
 * Validate a URL before POSTing the vault password to it. `configureRuntime`
 * already validates values installed via the registry, but `opts.vultiServerUrl`
 * and `opts.relayUrl` let callers override per-request — we must re-validate
 * here so the password never reaches a URL the SDK hasn't accepted.
 */
function assertHttpUrl(field: 'vultiServerUrl' | 'relayUrl', value: string): void {
  if (value.length === 0) {
    throw new Error(`fastVaultSign: ${field} must not be empty`)
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`fastVaultSign: ${field}=${JSON.stringify(value)} is not a valid URL`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`fastVaultSign: ${field} must be http(s), got ${parsed.protocol}`)
  }
}

export async function fastVaultSign(opts: FastVaultSignOptions): Promise<string> {
  const maxAttempts = opts.maxAttempts ?? 2
  let lastErr: Error | undefined
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fastVaultSignAttempt(opts)
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
      const msg = lastErr.message.toLowerCase()
      // Use word-boundary regex for HTTP 5xx so error strings like
      // "port 5001 closed" or "txid ...5000..." don't accidentally match.
      const has5xx = /\b5\d{2}\b/.test(msg)
      const retryable =
        msg.includes('timeout') ||
        msg.includes('deadline') ||
        msg.includes('unreachable') ||
        has5xx ||
        msg.includes('keysign failed')
      if (attempt < maxAttempts && retryable) {
        await sleep(2000)
        continue
      }
      throw lastErr
    }
  }
  throw lastErr!
}

async function fastVaultSignAttempt(opts: FastVaultSignOptions): Promise<string> {
  const {
    keyshareBase64,
    messageHashHex,
    serverDerivePath,
    localDerivePath,
    localPartyId,
    vaultPassword,
    publicKeyEcdsa,
    chain = 'Ethereum',
    isEcdsa = true,
  } = opts

  const vultiServerUrl = opts.vultiServerUrl ?? getConfiguredVultiServerUrl() ?? DEFAULT_VULTI_SERVER_URL
  const relayUrl = opts.relayUrl ?? getConfiguredRelayUrl() ?? DEFAULT_RELAY_URL
  assertHttpUrl('vultiServerUrl', vultiServerUrl)
  assertHttpUrl('relayUrl', relayUrl)

  const sessionId = randomUUID()
  const hexEncryptionKey = randomHex(32)

  const signPayload = {
    public_key: publicKeyEcdsa,
    messages: [messageHashHex],
    session: sessionId,
    hex_encryption_key: hexEncryptionKey,
    derive_path: serverDerivePath,
    is_ecdsa: isEcdsa,
    vault_password: vaultPassword,
    chain,
  }

  const res = await fetch(`${vultiServerUrl}/sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signPayload),
  })
  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`VultiServer sign failed: ${res.status} - ${errBody.substring(0, 200)}`)
  }
  await res.text()

  await joinRelaySession(relayUrl, sessionId, localPartyId)
  const parties = await waitForParties(relayUrl, sessionId, 2, 60_000)
  await startRelaySession(relayUrl, sessionId, parties)

  const serverPartyId = parties.find(p => p !== localPartyId) ?? parties[0]!
  const mpcChainPath = localDerivePath.replaceAll("'", '')

  const result = await keysign({
    keyShare: keyshareBase64,
    signatureAlgorithm: isEcdsa ? 'ecdsa' : 'eddsa',
    message: messageHashHex,
    chainPath: mpcChainPath,
    localPartyId,
    peers: [serverPartyId],
    serverUrl: relayUrl,
    sessionId,
    hexEncryptionKey,
    isInitiatingDevice: true,
  })

  const sig = result as { r: string; s: string; recovery_id?: string }
  if (isEcdsa) {
    // For ECDSA, `recovery_id` is required — EVM signatures compute
    // `v = recovery_id + chainId * 2 + 35`. A silent fallback to `'00'`
    // would produce a signature that recovers the wrong signer and would
    // be rejected by the chain (or credit funds to a different address),
    // so fail loud here instead.
    // Validate recovery_id is 1-2 hex chars parsing to 0-3. A silent fallback
    // to '00' (or a non-hex string being coerced) would produce a signature
    // that recovers the wrong signer — which on EVM credits funds to a
    // different address.
    const rawRid = sig.recovery_id
    if (!rawRid || typeof rawRid !== 'string' || !/^[0-9a-fA-F]{1,2}$/.test(rawRid)) {
      throw new Error(
        'fastVaultSign: MPC engine returned ECDSA signature without a valid recovery_id — ' +
          'refusing to fall back to v=0 (would produce a tx that recovers the wrong signer)'
      )
    }
    const ridNum = parseInt(rawRid, 16)
    if (!Number.isInteger(ridNum) || ridNum < 0 || ridNum > 3) {
      throw new Error(`fastVaultSign: recovery_id out of range (got ${rawRid}, expected 0-3)`)
    }
    // Normalise single-char recovery_id to two hex chars (e.g. "0" → "00", "1" → "01").
    const rid = rawRid.length === 1 ? '0' + rawRid : rawRid
    return sig.r + sig.s + rid
  }
  return sig.r + sig.s
}

export type SchnorrSignOptions = Omit<FastVaultSignOptions, 'serverDerivePath' | 'isEcdsa'> & {
  derivePath: string
}

/**
 * EdDSA (Schnorr) MPC signing. Thin wrapper around `fastVaultSign` with
 * `isEcdsa: false`. Returns signature as raw bytes (R || S, 64 bytes).
 */
export async function schnorrSign(opts: SchnorrSignOptions): Promise<Uint8Array> {
  const sigHex = await fastVaultSign({
    ...opts,
    serverDerivePath: opts.derivePath,
    localDerivePath: opts.derivePath,
    isEcdsa: false,
  })
  const bytes = new Uint8Array(sigHex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(sigHex.substring(i * 2, i * 2 + 2), 16)
  }
  return bytes
}
