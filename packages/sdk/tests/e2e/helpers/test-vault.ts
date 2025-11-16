/**
 * Test Vault Helper
 *
 * Provides utilities for loading and using a pre-created persistent fast vault
 * for E2E testing. This avoids the need to create new vaults for every test run.
 *
 * SECURITY: Vault path and password MUST be loaded from environment variables.
 * See tests/e2e/SECURITY.md for setup instructions.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { Vault, Vultisig } from '@/index'

/**
 * Get test vault configuration from environment variables
 *
 * REQUIRED: Both TEST_VAULT_PATH and TEST_VAULT_PASSWORD must be set.
 * See tests/e2e/SECURITY.md for setup instructions.
 *
 * @throws Error if environment variables are not set
 */
function getVaultCredentials(): { path: string; password: string } {
  const envPath = process.env.TEST_VAULT_PATH
  const envPassword = process.env.TEST_VAULT_PASSWORD

  // Both variables must be set
  if (!envPath || !envPassword) {
    throw new Error(
      '❌ TEST_VAULT_PATH and TEST_VAULT_PASSWORD environment variables are required!\n' +
        '\n' +
        'Setup instructions:\n' +
        '1. Create a test vault with small amounts for testing\n' +
        '2. Create tests/e2e/.env file:\n' +
        '   TEST_VAULT_PATH=/path/to/your/vault.vult\n' +
        '   TEST_VAULT_PASSWORD=your-secure-password\n' +
        '\n' +
        'See tests/e2e/SECURITY.md for detailed instructions.\n' +
        '\n' +
        'Current status:\n' +
        '  TEST_VAULT_PATH: ' +
        (envPath ? 'SET' : 'NOT SET') +
        '\n' +
        '  TEST_VAULT_PASSWORD: ' +
        (envPassword ? 'SET' : 'NOT SET')
    )
  }

  return {
    path: resolve(envPath),
    password: envPassword,
  }
}

/**
 * Test vault configuration
 *
 * Credentials are loaded from environment variables:
 * - TEST_VAULT_PATH: Path to your test vault file
 * - TEST_VAULT_PASSWORD: Password for your test vault
 *
 * See tests/e2e/SECURITY.md for setup instructions.
 */
export const TEST_VAULT_CONFIG = {
  /** Get vault path from environment */
  get path(): string {
    return getVaultCredentials().path
  },

  /** Get vault password from environment */
  get password(): string {
    return getVaultCredentials().password
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
 * Performs basic validation checks to ensure the vault is properly loaded.
 * Works with any vault (default or custom).
 *
 * @param vault - The vault instance to verify
 * @throws Error if vault is invalid or missing required data
 */
export function verifyTestVault(vault: Vault): void {
  const summary = vault.summary()

  // Basic validation checks
  if (!summary.name) {
    throw new Error('Vault has no name')
  }

  if (!summary.type) {
    throw new Error('Vault has no type')
  }

  const publicKeys = vault.data.publicKeys
  if (!publicKeys || !publicKeys.ecdsa || !publicKeys.eddsa) {
    throw new Error('Vault is missing required public keys (ecdsa/eddsa)')
  }

  // Log vault info for debugging
  console.log(
    `✅ Test vault verified: "${summary.name}" (type: ${summary.type})`
  )
  console.log(`   ECDSA: ${publicKeys.ecdsa.substring(0, 20)}...`)
  console.log(`   EdDSA: ${publicKeys.eddsa.substring(0, 20)}...`)
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
