/**
 * Signing Helper Functions
 *
 * Utilities for fast signing tests including signing payload creation
 * and signature validation.
 */

import type { KeysignPayload } from '@core/mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { expect } from 'vitest'

import type { Chain, Signature, SigningPayload } from '@/types'

/**
 * Create a SigningPayload from KeysignPayload and message hashes
 *
 * Combines the keysign payload with extracted message hashes to create
 * a SigningPayload suitable for vault.sign().
 *
 * @param keysignPayload - Payload from vault.prepareSendTx()
 * @param messageHashes - Pre-computed message hashes
 * @param chain - Chain identifier
 * @returns SigningPayload ready for vault.sign()
 *
 * @example
 * ```typescript
 * const signingPayload = createSigningPayload(keysignPayload, messageHashes, Chain.Ethereum)
 * const signature = await vault.sign('fast', signingPayload, password)
 * ```
 */
export function createSigningPayload(
  keysignPayload: KeysignPayload,
  messageHashes: string[],
  chain: Chain
): SigningPayload {
  return {
    transaction: keysignPayload,
    chain,
    messageHashes,
  }
}

/**
 * Validate signature format for a given chain
 *
 * Checks that the signature has the correct structure and format
 * based on the chain's signature algorithm (ECDSA vs EdDSA).
 *
 * @param signature - Signature returned from vault.sign()
 * @param chain - Chain that was signed
 * @param expectFormat - Expected signature format ('ECDSA' or 'EdDSA')
 *
 * @example
 * ```typescript
 * const signature = await vault.sign('fast', signingPayload, password)
 * validateSignatureFormat(signature, Chain.Ethereum, 'ECDSA')
 * ```
 */
export function validateSignatureFormat(
  signature: Signature,
  chain: Chain,
  expectFormat: 'ECDSA' | 'EdDSA' | 'Ed25519'
): void {
  // Basic signature validation
  expect(signature).toBeDefined()
  expect(signature.signature).toBeDefined()
  expect(typeof signature.signature).toBe('string')
  expect(signature.signature.length).toBeGreaterThan(0)

  // Validate hex encoding
  expect(signature.signature).toMatch(/^[0-9a-f]+$/i)

  // Validate format
  expect(signature.format).toBe(expectFormat)

  // ECDSA signatures should have recovery ID
  if (expectFormat === 'ECDSA') {
    expect(signature.recovery).toBeDefined()
    expect(typeof signature.recovery).toBe('number')
  }

  // EdDSA signatures typically don't have recovery ID
  if (expectFormat === 'EdDSA' || expectFormat === 'Ed25519') {
    // Recovery ID is optional for EdDSA
  }
}

/**
 * Standard test amounts for each chain (in smallest unit)
 *
 * These amounts are chosen to be ~$1 USD equivalent for consistency.
 * They're small enough to minimize cost but large enough to avoid dust limits.
 */
export const TEST_AMOUNTS: Partial<Record<Chain, bigint>> = {
  Bitcoin: 1000n, // ~0.00001 BTC (~$1 at $98,000/BTC)
  Litecoin: 100000n, // ~0.001 LTC (~$0.10 at $100/LTC)
  Ethereum: 300000000000000n, // ~0.0003 ETH (~$1 at $3300/ETH)
  Solana: 5400000n, // ~0.0054 SOL (~$1 at $185/SOL)
  THORChain: 20000000n, // 0.2 RUNE (~$1 at $5/RUNE)
  Cosmos: 167000n, // ~0.167 ATOM (~$1 at $6/ATOM)
  Polkadot: 147000000n, // ~0.0147 DOT (~$1 at $68/DOT)
  Sui: 312500000n, // ~0.3125 SUI (~$1 at $3.20/SUI)
}

/**
 * Standard test receiver addresses for each chain
 *
 * These are well-known test addresses or burn addresses.
 * DO NOT use your own addresses here to avoid accidental sends.
 */
export const TEST_RECEIVERS: Partial<Record<Chain, string>> = {
  // Bitcoin: Example address (DO NOT send real funds)
  Bitcoin: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',

  // Litecoin: Example address (DO NOT send real funds)
  Litecoin: 'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9',

  // Ethereum: Example address (DO NOT send real funds)
  Ethereum: '0x742D35cC6634C0532925A3b844bc9E7595f0BEb8',

  // Solana: Example address (DO NOT send real funds)
  Solana: 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK',

  // THORChain: Example address (DO NOT send real funds)
  THORChain: 'thor1g98cy3n9mmjrpn0sxmn63lztelera37n8n67c0',

  // Cosmos: Example address (DO NOT send real funds)
  Cosmos: 'cosmos1fl48vsnmsdzcv85q5d2q4z5ajdha8yu34mf0eh',

  // Polkadot: Example address (DO NOT send real funds)
  Polkadot: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',

  // Sui: Example address (DO NOT send real funds)
  Sui: '0x2b93c2c27e68e9bedb01fa44b0dc5a3afa0e67f38a54fee999f24b7d88ac7f1e',
}
