/**
 * Load a .vult backup after bootstrap-wasm-for-live-push has been imported.
 */
import { readFile } from 'node:fs/promises'

import { Chain } from '@vultisig/core-chain/Chain'

import { MemoryStorage } from '../../src/storage/MemoryStorage'
import { Vultisig } from '../../src/Vultisig'

const DEFAULT_CHAINS = [
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
]

export async function loadVaultFromDisk(
  vaultPath: string,
  password: string
): Promise<{ sdk: Vultisig; vault: import('../../src/vault/VaultBase').VaultBase }> {
  const sdk = new Vultisig({
    storage: new MemoryStorage(),
    serverEndpoints: {
      fastVault: process.env.VULTISIG_API_URL || 'https://api.vultisig.com/vault',
      messageRelay: process.env.VULTISIG_ROUTER_URL || 'https://api.vultisig.com/router',
    },
    defaultChains: DEFAULT_CHAINS,
    defaultCurrency: 'usd',
  })

  await sdk.initialize()
  const vaultContent = await readFile(vaultPath, 'utf-8')
  const vault = await sdk.importVault(vaultContent, password)
  return { sdk, vault }
}
