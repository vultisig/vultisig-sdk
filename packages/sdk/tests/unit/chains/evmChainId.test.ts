import { describe, expect, it } from 'vitest'

import type { EvmChain } from '../../../src'
import { Chain, getEvmChainByChainId, getEvmChainId } from '../../../src'

// Canonical EVM chainIds (numeric), the single source of truth the app and
// agent-backend-ts previously hand-maintained as their own copies. Pinning
// them here guards against the drift class that caused the Hyperliquid
// 998/999 client↔server chainId bug.
// `satisfies Record<EvmChain, number>` makes this exhaustive: adding a 14th EvmChain to the enum without
// pinning its chainId here is a COMPILE error, so a new chain can't silently escape the drift guard.
const CANONICAL_EVM_CHAIN_IDS = {
  [Chain.Ethereum]: 1,
  [Chain.BSC]: 56,
  [Chain.Polygon]: 137,
  [Chain.Avalanche]: 43114,
  [Chain.Arbitrum]: 42161,
  [Chain.Optimism]: 10,
  [Chain.Base]: 8453,
  [Chain.Blast]: 81457,
  [Chain.Mantle]: 5000,
  [Chain.Zksync]: 324,
  [Chain.CronosChain]: 25,
  [Chain.Hyperliquid]: 999,
  [Chain.Sei]: 1329,
} satisfies Record<EvmChain, number>

describe('EVM chainId public API', () => {
  it('exposes getEvmChainId and getEvmChainByChainId from the SDK public entry', () => {
    expect(typeof getEvmChainId).toBe('function')
    expect(typeof getEvmChainByChainId).toBe('function')
  })

  it('pins every EVM chainId (hex) to its canonical numeric value', () => {
    for (const [chain, numericId] of Object.entries(CANONICAL_EVM_CHAIN_IDS)) {
      const hex = getEvmChainId(chain as EvmChain)
      expect(hex.startsWith('0x')).toBe(true)
      expect(parseInt(hex, 16)).toBe(numericId)
    }
  })

  it('round-trips chain -> chainId -> chain for every EVM chain', () => {
    for (const chain of Object.keys(CANONICAL_EVM_CHAIN_IDS)) {
      const hex = getEvmChainId(chain as EvmChain)
      expect(getEvmChainByChainId(hex)).toBe(chain)
    }
  })

  it('pins the Hyperliquid mainnet chainId to 999 (not testnet 998)', () => {
    expect(parseInt(getEvmChainId(Chain.Hyperliquid), 16)).toBe(999)
  })
})
