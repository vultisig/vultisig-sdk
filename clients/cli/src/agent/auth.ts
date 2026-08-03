/**
 * Agent Authentication
 *
 * Handles EIP-191 personal_sign authentication with the agent-backend.
 * Signs a challenge message using the vault's ECDSA key to obtain a JWT token.
 */
import { randomBytes } from 'node:crypto'

import type { VaultBase } from '@vultisig/sdk'
import { Chain, computePersonalSignHash, formatEcdsaSignature65 } from '@vultisig/sdk'

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
): Promise<{ token: string; expiresAt: number; refreshToken?: string }> {
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

      const signature = await vault.signBytes({ data: Buffer.from(messageHash), chain: Chain.Ethereum }, {})

      // Format signature as 65-byte hex (r + s + v)
      if (signature.recovery === undefined) {
        throw new Error('Agent authentication requires an ECDSA recovery id')
      }
      const sigHex = formatEcdsaSignature65(signature.signature, signature.recovery)

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
        // Captured + persisted by the session token cache. The backend exposes
        // POST /auth/refresh to exchange it for a fresh access token without a
        // new MPC round; wiring that exchange is a future enhancement — today
        // the CLI re-auths via a full MPC re-sign (authenticateVault), which is
        // always available and avoids depending on refresh-token rotation.
        refreshToken: authResponse.refresh_token,
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

// Backwards-compatible test/import aliases while the CLI consumes the public SDK helpers.
export { computePersonalSignHash, formatEcdsaSignature65 as formatSignature65 }
