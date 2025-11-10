/**
 * Test Vault Helper
 *
 * Provides utilities for loading and using a pre-created persistent fast vault
 * for E2E testing. This avoids the need to create new vaults for every test run.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { Vault, Vultisig } from '@/index'

/**
 * Pre-created test vault configuration
 *
 * Vault: TestFastVault-44fd-share2of2
 * Type: Fast (2-of-2 MPC with VultiServer)
 * Password: Password123!
 * Created: 2025-06-09
 */
export const TEST_VAULT_CONFIG = {
  /** Path to the .vult file */
  path: resolve(
    __dirname,
    '../fixtures/vaults/TestFastVault-44fd-share2of2-Password123!.vult'
  ),

  /** Vault password */
  password: 'Password123!',

  /** Vault name */
  name: 'TestFastVault',

  /** Vault type */
  type: 'fast' as const,

  /** Public keys */
  publicKeys: {
    ecdsa: '03ac0f333fc5d22f929e013be80988f57a56837db64d968c126ca4c943984744fd',
    eddsa: 'dff9b5b456eadcbd99366fd691f50f865a26df433f9cbffe1b6f319ecadb8308',
  },

  /** Pre-derived addresses for major chains */
  addresses: {
    Bitcoin: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
    Ethereum: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
    THORChain: 'thor1nuwfr59wyn6da6v5ktxsa32v2t6u2q4veg9awu',
    Cosmos: 'cosmos1axf2e8w0k73gp7zmfqcx7zssma34haxh7xwlsu',
    Solana: 'G5Jm9g1NH1xprPz3ZpnNmF8Wkz2F6YUhkxpf432mRefR',
    Cardano: 'addr1v8ktk0y6xkhy7k60wzdwwkc77n7cvlduw2cuew2a0frk6aq8ahycw',
    Polkadot: '164frjvvMTVaeZS5No4KfjsVEQFruHY1tZAhXd5WMGQB4yva',
    Ripple: 'rpauN4CN6hDdZBwjTbPvtdW6TBVzroFQCm',
    Tron: 'TSZh1ddJLcVruiC6kZYojtAVwKawC2jVj5',
    Litecoin: 'ltc1qkdau9j2puxrsu0vlwa6q7cysq8ys97w2tk7whc',
    Dogecoin: 'DTSParRZGeQSzPK2uTvzFCtsiWfTbwvmUZ',
    BSC: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
    Avalanche: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
    Polygon: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
    Arbitrum: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
    Optimism: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
    Base: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
    Osmosis: 'osmo1axf2e8w0k73gp7zmfqcx7zssma34haxhkaa0xw',
    Sui: '0x61102d766fc7e62ff2d1f2094636e4d04dc137ee3bb469a8d027c3f432d715fe',
    MayaChain: 'maya1nuwfr59wyn6da6v5ktxsa32v2t6u2q4velm3cv',
    Ton: 'UQCeg8c0AuZfbZbYf_WtzgKXnPLUwXkPjZwEKB16VzwSC4Yl',
  },

  /** Chains to test (subset of all supported chains) */
  testChains: [
    'Bitcoin',
    'Ethereum',
    'Solana',
    'THORChain',
    'Cosmos',
    'BSC',
    'Polygon',
    'Avalanche',
    'Arbitrum',
    'Optimism',
    'Base',
    'Osmosis',
  ],
}

/**
 * Shared Vultisig instance for E2E tests
 *
 * CRITICAL: This singleton prevents multiple WASM loads that cause OOM errors.
 * Each Vultisig instance loads its own WASM modules (10-20MB+ each).
 * By sharing one instance across all E2E test files, we reduce memory by 4x.
 *
 * This is safe because:
 * - E2E tests are read-only (no state mutations)
 * - Tests run sequentially (singleThread: true in vitest.config)
 * - All tests use the same test vault anyway
 */
let sharedSdk: Vultisig | null = null
let sharedVault: Vault | null = null
let initializationPromise: Promise<{ sdk: Vultisig; vault: Vault }> | null =
  null

/**
 * Load the persistent test vault
 *
 * This function imports the pre-created test vault and returns both the SDK
 * instance and the vault instance. Use this in beforeAll() hooks to set up
 * E2E tests.
 *
 * IMPORTANT: This now returns a shared singleton instance to prevent memory
 * exhaustion from multiple WASM loads. All E2E test files share the same
 * Vultisig and Vault instances.
 *
 * @param sdk - Optional pre-initialized Vultisig instance. If not provided,
 *              a shared singleton will be used/created
 * @returns Object containing the SDK instance and imported vault
 *
 * @example
 * ```typescript
 * describe('E2E: Balance Operations', () => {
 *   let sdk: Vultisig;
 *   let vault: Vault;
 *
 *   beforeAll(async () => {
 *     const result = await loadTestVault();
 *     sdk = result.sdk;
 *     vault = result.vault;
 *   });
 *
 *   it('should fetch Bitcoin balance', async () => {
 *     const balance = await vault.balance('Bitcoin');
 *     expect(balance.symbol).toBe('BTC');
 *   });
 * });
 * ```
 */
export async function loadTestVault(
  sdk?: Vultisig
): Promise<{ sdk: Vultisig; vault: Vault }> {
  // If SDK provided, use it directly (bypass singleton for custom tests)
  if (sdk) {
    const vaultBuffer = await readFile(TEST_VAULT_CONFIG.path)
    const vaultFile = new File(
      [new Uint8Array(vaultBuffer)],
      'TestFastVault.vult',
      {
        type: 'application/octet-stream',
      }
    )
    const vault = await sdk.addVault(vaultFile, TEST_VAULT_CONFIG.password)
    return { sdk, vault }
  }

  // Return existing shared instance if available
  if (sharedSdk && sharedVault) {
    return { sdk: sharedSdk, vault: sharedVault }
  }

  // If initialization is in progress, wait for it
  if (initializationPromise) {
    return initializationPromise
  }

  // Start new initialization (singleton pattern)
  initializationPromise = (async () => {
    console.log(
      '🔧 Creating shared Vultisig instance for E2E tests (prevents memory exhaustion)...'
    )

    // Import SDK and create singleton instance
    const { Vultisig } = await import('@/index')
    sharedSdk = new Vultisig({ autoInit: true })
    await sharedSdk.initialize()

    console.log('✅ Shared Vultisig instance initialized (WASM loaded once)')

    // Read vault file
    const vaultBuffer = await readFile(TEST_VAULT_CONFIG.path)

    // Create File object (browser-compatible in Node.js via polyfill)
    // Convert Buffer to Uint8Array for better compatibility with BlobPart
    const vaultFile = new File(
      [new Uint8Array(vaultBuffer)],
      'TestFastVault.vult',
      {
        type: 'application/octet-stream',
      }
    )

    // Import vault
    sharedVault = await sharedSdk.addVault(
      vaultFile,
      TEST_VAULT_CONFIG.password
    )

    console.log('✅ Shared test vault loaded (reused across all E2E tests)')

    return { sdk: sharedSdk, vault: sharedVault }
  })()

  return initializationPromise
}

/**
 * Verify that the test vault loaded correctly
 *
 * @param vault - The vault instance to verify
 * @throws Error if vault data doesn't match expected configuration
 */
export function verifyTestVault(vault: Vault): void {
  const summary = vault.summary()

  if (summary.name !== TEST_VAULT_CONFIG.name) {
    throw new Error(
      `Expected vault name "${TEST_VAULT_CONFIG.name}", got "${summary.name}"`
    )
  }

  if (summary.type !== TEST_VAULT_CONFIG.type) {
    throw new Error(
      `Expected vault type "${TEST_VAULT_CONFIG.type}", got "${summary.type}"`
    )
  }

  const publicKeys = vault.data.publicKeys
  if (publicKeys.ecdsa !== TEST_VAULT_CONFIG.publicKeys.ecdsa) {
    throw new Error(
      `ECDSA public key mismatch: expected ${TEST_VAULT_CONFIG.publicKeys.ecdsa}, got ${publicKeys.ecdsa}`
    )
  }

  if (publicKeys.eddsa !== TEST_VAULT_CONFIG.publicKeys.eddsa) {
    throw new Error(
      `EdDSA public key mismatch: expected ${TEST_VAULT_CONFIG.publicKeys.eddsa}, got ${publicKeys.eddsa}`
    )
  }
}

/**
 * Get expected address for a chain
 *
 * @param chain - Chain name (e.g., 'Bitcoin', 'Ethereum')
 * @returns Expected address for the chain, or undefined if not pre-calculated
 */
export function getExpectedAddress(chain: string): string | undefined {
  return TEST_VAULT_CONFIG.addresses[
    chain as keyof typeof TEST_VAULT_CONFIG.addresses
  ]
}

/**
 * Check if a chain is in the test suite
 *
 * @param chain - Chain name to check
 * @returns True if the chain should be tested
 */
export function isTestChain(chain: string): boolean {
  return TEST_VAULT_CONFIG.testChains.includes(chain)
}

/**
 * Reset shared instances (useful for testing or cleanup)
 * WARNING: Only use this between test runs, not during tests!
 */
export function resetSharedInstances(): void {
  sharedSdk = null
  sharedVault = null
  initializationPromise = null
  console.log('🔄 Shared E2E test instances reset')
}

/**
 * Get current memory usage statistics
 * Useful for monitoring memory consumption during E2E tests
 */
export function getMemoryUsage() {
  const usage = process.memoryUsage()
  return {
    heapUsedMB: Math.round(usage.heapUsed / 1024 / 1024),
    heapTotalMB: Math.round(usage.heapTotal / 1024 / 1024),
    externalMB: Math.round(usage.external / 1024 / 1024),
    rssMB: Math.round(usage.rss / 1024 / 1024),
  }
}

/**
 * Log memory usage with optional label
 * Useful for tracking memory at different points in tests
 */
export function logMemoryUsage(label: string = 'Memory'): void {
  const mem = getMemoryUsage()
  console.log(
    `📊 ${label}: ${mem.heapUsedMB}MB / ${mem.heapTotalMB}MB heap, ${mem.rssMB}MB RSS`
  )
}
