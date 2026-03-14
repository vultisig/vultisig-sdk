/**
 * Agent Authentication
 *
 * Handles EIP-191 personal_sign authentication with the agent-backend.
 * Signs a challenge message using the vault's ECDSA key to obtain a JWT token.
 */
import { randomBytes } from 'node:crypto'

import { keccak_256 } from '@noble/hashes/sha3'

import type { VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'

import type { AgentClient } from './client'

/**
 * Authenticate a vault with the agent-backend and obtain a JWT token.
 *
 * Flow:
 * 1. Derive Ethereum address from vault
 * 2. Create auth message with nonce and expiry
 * 3. Sign with EIP-191 personal_sign using vault's MPC
 * 4. Exchange signature for JWT token
 *
 * Retries MPC signing up to maxAttempts times on transient failures.
 */
export async function authenticateVault(
  client: AgentClient,
  vault: VaultBase,
  password?: string,
  maxAttempts = 3
): Promise<{ token: string; expiresAt: number }> {
  // Get vault keys
  const publicKey = vault.publicKeys.ecdsa
  const chainCode = vault.hexChainCode

  // Get the Ethereum address for the auth message
  const ethAddress = await vault.address(Chain.Ethereum)

  // Generate nonce (32 random hex bytes)
  const nonce = '0x' + randomBytes(16).toString('hex')

  // Set expiry to 15 minutes from now
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()

  // Create the auth message (must match backend expectations)
  const authMessage = JSON.stringify({
    message: 'Sign into Vultisig Plugin Marketplace',
    nonce,
    expiresAt,
    address: ethAddress,
  })

  // Compute EIP-191 personal_sign hash
  const messageHash = computePersonalSignHash(authMessage)

  // Sign the hash using the vault's MPC signing (with retry)
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) {
        process.stderr.write(`  Retry ${attempt}/${maxAttempts}...\n`)
      }

      const signature = await vault.signBytes(
        { data: Buffer.from(messageHash), chain: Chain.Ethereum },
        {}
      )

      // Format signature as 65-byte hex (r + s + v)
      const sigHex = formatSignature65(signature.signature, signature.recovery ?? 0)

      // Authenticate with the backend
      const authResponse = await client.authenticate({
        public_key: publicKey,
        chain_code_hex: chainCode,
        message: authMessage,
        signature: sigHex,
      })

      return {
        token: authResponse.token,
        expiresAt: authResponse.expires_at,
      }
    } catch (err: any) {
      lastError = err
      if (attempt < maxAttempts && err.message?.includes('timeout')) {
        continue
      }
      throw err
    }
  }

  throw lastError || new Error('Authentication failed after all attempts')
}

/**
 * Compute EIP-191 personal_sign hash.
 *
 * Hash = keccak256("\x19Ethereum Signed Message:\n" + len(message) + message)
 *
 * Returns 32-byte Uint8Array hash.
 */
function computePersonalSignHash(message: string): Uint8Array {
  const messageBytes = new TextEncoder().encode(message)
  const prefix = `\x19Ethereum Signed Message:\n${messageBytes.length}`
  const prefixBytes = new TextEncoder().encode(prefix)

  // Concatenate prefix + message
  const combined = new Uint8Array(prefixBytes.length + messageBytes.length)
  combined.set(prefixBytes)
  combined.set(messageBytes, prefixBytes.length)

  return keccak_256(combined)
}

/**
 * Format a DER-encoded ECDSA signature into 65-byte hex string (r || s || v).
 *
 * The SDK returns signature as DER-encoded hex for ECDSA.
 * The backend expects raw r || s || v (65 bytes total).
 * v = 27 or 28 (from recovery id 0 or 1).
 */
function formatSignature65(sigHex: string, recovery: number): string {
  // Remove 0x prefix if present
  const hex = sigHex.startsWith('0x') ? sigHex.slice(2) : sigHex
  const bytes = Buffer.from(hex, 'hex')

  // Check if DER-encoded (starts with 0x30 = SEQUENCE)
  if (bytes[0] === 0x30) {
    const { r, s } = decodeDERSignature(bytes)
    const v = (recovery + 27).toString(16).padStart(2, '0')
    return r + s + v
  }

  // If already raw format (128 hex chars = 64 bytes r+s)
  if (hex.length >= 128) {
    const rs = hex.slice(0, 128)
    const v = (recovery + 27).toString(16).padStart(2, '0')
    return rs + v
  }

  throw new Error(`Cannot format signature: unrecognized format (${hex.length} hex chars)`)
}

/**
 * Decode a DER-encoded ECDSA signature into 32-byte r and s values.
 *
 * DER format:
 *   30 <total_len>
 *     02 <r_len> <r_bytes>
 *     02 <s_len> <s_bytes>
 *
 * Returns r and s as 32-byte zero-padded hex strings.
 */
function decodeDERSignature(der: Buffer): { r: string; s: string } {
  let offset = 0

  // SEQUENCE tag
  if (der[offset++] !== 0x30) throw new Error('Invalid DER: expected SEQUENCE')
  offset++ // skip total length

  // INTEGER for r
  if (der[offset++] !== 0x02) throw new Error('Invalid DER: expected INTEGER for r')
  const rLen = der[offset++]
  let rBytes = der.subarray(offset, offset + rLen)
  offset += rLen

  // INTEGER for s
  if (der[offset++] !== 0x02) throw new Error('Invalid DER: expected INTEGER for s')
  const sLen = der[offset++]
  let sBytes = der.subarray(offset, offset + sLen)

  // Strip leading zero bytes (used for positive sign in DER) and pad to 32 bytes
  const r = padTo32Bytes(stripLeadingZeros(rBytes))
  const s = padTo32Bytes(stripLeadingZeros(sBytes))

  return { r, s }
}

function stripLeadingZeros(buf: Buffer | Uint8Array): Buffer {
  let start = 0
  while (start < buf.length - 1 && buf[start] === 0) start++
  return Buffer.from(buf.subarray(start))
}

function padTo32Bytes(buf: Buffer): string {
  if (buf.length > 32) {
    // Take the last 32 bytes
    return buf.subarray(buf.length - 32).toString('hex')
  }
  return buf.toString('hex').padStart(64, '0')
}
