/**
 * Test Vault Helper Functions
 *
 * Utilities for loading and verifying test vaults in E2E tests.
 * Uses global singletons for configuration.
 */

import { Chain } from '@core/chain/Chain'
import fs from 'fs/promises'
import { resolve } from 'path'
import { expect } from 'vitest'

import { GlobalConfig } from '../../../src/config/GlobalConfig'
import { GlobalStorage } from '../../../src/runtime/storage/GlobalStorage'
import { MemoryStorage } from '../../../src/runtime/storage/MemoryStorage'
import { GlobalServerManager } from '../../../src/server/GlobalServerManager'
import { PasswordCacheService } from '../../../src/services/PasswordCacheService'
import { VaultBase } from '../../../src/vault/VaultBase'
import { Vultisig } from '../../../src/Vultisig'

/**
 * Test vault configuration
 */
export const TEST_VAULT_CONFIG = {
  // Vault credentials (from environment variables or defaults)
  path: process.env.TEST_VAULT_PATH || resolve(__dirname, '../fixtures/test-vault.vult'),
  password: process.env.TEST_VAULT_PASSWORD || 'test-password',

  // Expected vault properties (for verification)
  addresses: {
    Bitcoin: 'bc1qxkymttl27q3y200zngaf6r3z88a6cw365yzqf3',
    Ethereum: '0xC190DDb708e948832FFb41CED2AB29A4a6a978DD',
    Solana: 'DEqXP4qf9dEYB7okqYbGAmjCgPjdy7vDDZ5gFBieT99F',
  },

  // Test chains to use
  testChains: [
    Chain.Bitcoin,
    Chain.Ethereum,
    Chain.Solana,
    Chain.Polygon,
    Chain.BSC,
    Chain.Avalanche,
    Chain.Arbitrum,
    Chain.Litecoin,
    Chain.Dogecoin,
    Chain.THORChain,
    Chain.Cosmos,
  ],
}

/**
 * Load test vault with global singleton configuration
 *
 * Initializes the SDK with global singletons and loads a test vault.
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
  // Reset all global singletons
  GlobalStorage.reset()
  GlobalServerManager.reset()
  GlobalConfig.reset()
  PasswordCacheService.resetInstance()

  // Configure global singletons
  const memoryStorage = new MemoryStorage()
  GlobalStorage.configure({ customStorage: memoryStorage })

  GlobalServerManager.configure({
    fastVault: process.env.VULTISIG_API_URL || 'https://api.vultisig.com/vault',
    messageRelay: process.env.VULTISIG_ROUTER_URL || 'https://api.vultisig.com/router',
  })

  GlobalConfig.configure({
    defaultChains: TEST_VAULT_CONFIG.testChains,
    defaultCurrency: 'usd',
  })

  // Initialize SDK with WASM
  const sdk = new Vultisig({
    autoInit: true,
    storage: { customStorage: memoryStorage },
    defaultChains: TEST_VAULT_CONFIG.testChains,
    defaultCurrency: 'usd',
  })

  await sdk.initialize()

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
