import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import { getTwChainId } from '@vultisig/core-chain/chains/evm/tx/tw/getTwChainId'
import { beforeAll, describe, expect, it } from 'vitest'

import type { EvmChain } from '../../../src'
import { Chain, getEvmChainByChainId, getEvmChainId, getEvmNumericChainId } from '../../../src'

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
  [Chain.Robinhood]: 4663,
} satisfies Record<EvmChain, number>

describe('EVM chainId public API', () => {
  it('exposes hex, numeric, and reverse chainId helpers from the SDK public entry', () => {
    expect(typeof getEvmChainId).toBe('function')
    expect(typeof getEvmNumericChainId).toBe('function')
    expect(typeof getEvmChainByChainId).toBe('function')
  })

  it('pins every public numeric and hex EVM chainId to the canonical value', () => {
    for (const [chain, numericId] of Object.entries(CANONICAL_EVM_CHAIN_IDS)) {
      expect(getEvmNumericChainId(chain as EvmChain)).toBe(numericId)

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
    expect(getEvmNumericChainId(Chain.Hyperliquid)).toBe(999)
  })
})

// The block above only pins the viem chain registry, i.e. the DISPLAY
// source. It says nothing about the chainId that actually lands in the
// SIGNED preimage on the wallet-core path
// (`CoinTypeExt.chainId(getCoinType(chain))`, wired through `getTwChainId`),
// A wrong `getCoinType` mapping could silently sign a transaction against the
// WRONG chainId (a replay/misdirection bug - the signed tx would be valid on a
// DIFFERENT chain) while every display surface kept showing the right value,
// and the suite above stayed green.
//
// The loop below iterates `CANONICAL_EVM_CHAIN_IDS`, which `satisfies
// Record<EvmChain, number>` keeps exhaustive against the `EvmChain` enum at
// compile time - a newly added EVM chain is automatically exercised the moment
// its canonical id is added above (and the build fails if it isn't).
//
// Hyperliquid and Sei aren't wallet-core-native coin types (`getCoinType`
// maps both to `CoinType.ethereum`), so `getTwChainId` special-cases them by
// returning the same viem chain objects' `.id` used to build the registry.
// No skip/carve-out needed here: pinning against `CANONICAL_EVM_CHAIN_IDS`
// exercises that special case exactly like every other chain.
describe('EVM chainId signed-preimage sources', () => {
  let walletCore: WalletCore

  beforeAll(async () => {
    walletCore = await initWasm()
  })

  it('pins the wallet-core signed chainId (CoinTypeExt.chainId via getTwChainId) for every EVM chain', () => {
    for (const [chain, numericId] of Object.entries(CANONICAL_EVM_CHAIN_IDS)) {
      expect(getTwChainId({ walletCore, chain: chain as EvmChain })).toBe(String(numericId))
    }
  })
})
