/**
 * Test Vault Helper Functions
 *
 * Utilities for loading and verifying test vaults in E2E tests.
 * Uses instance-scoped Vultisig with explicit dependencies.
 */

import { Chain } from '@vultisig/core-chain/Chain'
import { existsSync } from 'fs'
import fs from 'fs/promises'
import { resolve } from 'path'
import { expect } from 'vitest'

import { MemoryStorage } from '../../../src/storage/MemoryStorage'
import { VaultBase } from '../../../src/vault/VaultBase'
import { Vultisig } from '../../../src/Vultisig'

/**
 * Test vault configuration
 */
export const TEST_VAULT_CONFIG = {
  // Vault credentials (from environment variables or defaults)
  path: process.env.TEST_VAULT_PATH || resolve(__dirname, '../fixtures/test-vault.vult'),
  password: process.env.TEST_VAULT_PASSWORD || 'test-password',

  // Test chains to use
  testChains: [
    Chain.Bitcoin,
    Chain.Ethereum,
    Chain.Solana,
    Chain.Polygon,
    Chain.BSC,
    Chain.Avalanche,
    Chain.Arbitrum,
    Chain.Optimism,
    Chain.Base,
    Chain.Litecoin,
    Chain.Dogecoin,
    Chain.THORChain,
    Chain.Cosmos,
  ],
}

/**
 * Whether the test vault fixture exists. Use as the predicate for
 * `describe.skipIf(!HAS_TEST_VAULT_FIXTURE)` so E2E suites skip cleanly
 * on environments where the fixture isn't provisioned (CI without
 * secrets, fresh dev clones) instead of failing with a cryptic ENOENT.
 *
 * The fixture was deliberately removed from git in commit `e3811eea`
 * for security; see `tests/e2e/SECURITY.md` for setup or set
 * `TEST_VAULT_PATH` to an existing `.vult` file.
 */
export const HAS_TEST_VAULT_FIXTURE = existsSync(TEST_VAULT_CONFIG.path)

/**
 * SDK-TEST-02/03 (vultisig/vultisig-sdk#1069): a describe.skipIf'd suite
 * reports "skipped" in the vitest summary, but that summary line is easy to
 * miss - the job/workflow itself still exits 0 ("green"), which is exactly
 * what an unattended daily cron or a glance at the GitHub Actions checkmark
 * reads as "signing was verified." Print an explicit, impossible-to-miss
 * banner the moment any vault-gated E2E suite loads without a fixture, so
 * "green" never gets confused with "the real 2-of-2 signing ceremony ran."
 */
if (!HAS_TEST_VAULT_FIXTURE) {
  const message =
    `SKIPPING vault-gated E2E suite(s): no test vault fixture at ${TEST_VAULT_CONFIG.path}. ` +
    'This means the real vault.sign() 2-of-2 MPC round trip was NOT exercised in this run. ' +
    'See packages/sdk/tests/e2e/SECURITY.md to provision TEST_VAULT_PATH / TEST_VAULT_PASSWORD. ' +
    '(Always-on, non-vault-gated crypto round-trip coverage lives in ' +
    'tests/unit/crypto/signingRoundTrip.synthetic.test.ts.)'

  console.warn(`\n⚠️  ${message}\n`)

  // Inside GitHub Actions, also emit a workflow annotation so the skip shows
  // up as a visible yellow warning on the run summary - not just a line
  // buried in raw logs that nobody reads on a "green" daily cron.
  if (process.env.GITHUB_ACTIONS === 'true') {
    console.log(`::warning::${message}`)
  }
}

/**
 * Load test vault with instance-scoped configuration
 *
 * Creates an SDK instance with explicit dependencies and loads a test vault.
 * Uses environment variables for vault path and password if available.
 *
 * @returns Promise resolving to SDK instance and loaded vault
 *
 * @example
 * ```typescript
 * const { vault } = await loadTestVault()
 * const balance = await vault.balance(Chain.Bitcoin)
 * ```
 */
export async function loadTestVault(): Promise<{
  sdk: Vultisig
  vault: VaultBase
}> {
  // Create SDK with explicit storage (instance-scoped, not global)
  const sdk = new Vultisig({
    storage: new MemoryStorage(),
    serverEndpoints: {
      fastVault: process.env.VULTISIG_API_URL || 'https://api.vultisig.com/vault',
      messageRelay: process.env.VULTISIG_ROUTER_URL || 'https://api.vultisig.com/router',
    },
    defaultChains: TEST_VAULT_CONFIG.testChains,
    defaultCurrency: 'usd',
    // FastVault.sign hits the server even when the share was imported unencrypted; password may not
    // be cached — same password as import (env or default) satisfies resolvePassword().
    onPasswordRequired: async () => TEST_VAULT_CONFIG.password,
  })

  await sdk.initialize()

  // Defensive: callers should already gate via `describe.skipIf(!HAS_TEST_VAULT_FIXTURE)`.
  // If they didn't, surface a clear setup pointer instead of vitest's raw ENOENT.
  if (!HAS_TEST_VAULT_FIXTURE) {
    throw new Error(
      `Test vault fixture missing at ${TEST_VAULT_CONFIG.path}. ` +
        `See packages/sdk/tests/e2e/SECURITY.md for setup, or set TEST_VAULT_PATH ` +
        `to an existing .vult file. To skip cleanly when the fixture isn't available, ` +
        `wrap the suite with describe.skipIf(!HAS_TEST_VAULT_FIXTURE).`
    )
  }

  // Load vault from file
  const vaultContent = await fs.readFile(TEST_VAULT_CONFIG.path, 'utf-8')
  const vault = await sdk.importVault(vaultContent, TEST_VAULT_CONFIG.password)

  return { sdk, vault }
}

/**
 * Verify test vault properties
 *
 * Ensures the loaded vault has expected properties and can derive addresses.
 *
 * @param vault - Vault to verify
 *
 * @example
 * ```typescript
 * const { vault } = await loadTestVault()
 * verifyTestVault(vault)
 * ```
 */
export function verifyTestVault(vault: VaultBase): void {
  // Verify vault properties
  expect(vault).toBeDefined()
  expect(vault.name).toBeDefined()
  expect(vault.type).toBeDefined()
  expect(vault.data).toBeDefined()
  expect(vault.data.publicKeys).toBeDefined()
  expect(vault.data.publicKeys.ecdsa).toBeDefined()
  expect(vault.data.publicKeys.eddsa).toBeDefined()

  console.log(`✅ Vault verified: ${vault.name} (${vault.type})`)
}
