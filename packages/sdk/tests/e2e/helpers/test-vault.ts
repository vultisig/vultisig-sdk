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
 * SDK-TEST-02/03 (vultisig/vultisig-sdk#1069): `describe.skipIf(...)` marks
 * a suite "skipped" in the vitest summary, but plain top-level console
 * output emitted while the file's tests are all skipped is dropped by
 * vitest's reporters (verified empirically - it never reaches "verbose" or
 * "default" output), and the job/workflow itself still exits 0. Both add up
 * to a daily cron / CI run that can look identically green whether the real
 * vault.sign() 2-of-2 MPC round trip ran or never ran at all.
 *
 * Suites that gate on {@link HAS_TEST_VAULT_FIXTURE} should additionally add
 * one always-on canary test that calls `ctx.skip(NO_TEST_VAULT_SKIP_REASON)`
 * when the fixture is missing - vitest's verbose reporter prints a skip
 * *reason* inline next to the test name (unlike describe.skipIf, which does
 * not), so the "why" is visible in the same run instead of requiring someone
 * to go dig through tests/e2e/SECURITY.md.
 */
export const NO_TEST_VAULT_SKIP_REASON =
  `No test vault fixture at ${TEST_VAULT_CONFIG.path} - the real vault.sign() 2-of-2 MPC round trip ` +
  'was NOT exercised in this run. See packages/sdk/tests/e2e/SECURITY.md to provision TEST_VAULT_PATH ' +
  '/ TEST_VAULT_PASSWORD. Always-on synthetic crypto round-trip coverage: ' +
  'tests/unit/crypto/signingRoundTrip.synthetic.test.ts.'

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
