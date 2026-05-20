import { getAddress } from 'ethers'
import { describe, expect, it } from 'vitest'

import { EvmChain } from '../../../Chain'
import { type KnownEvmContractCategory, knownEvmContracts, lookupKnownEvmContract } from './knownContracts'

describe('knownEvmContracts', () => {
  it('every key is a lowercase 0x-prefixed 40-hex-char string', () => {
    for (const address of Object.keys(knownEvmContracts)) {
      expect(address).toMatch(/^0x[0-9a-f]{40}$/)
    }
  })

  it('every key is a checksum-valid EIP-55 address (sanity check)', () => {
    // Catches typos like dropped/extra chars by re-parsing through ethers.
    for (const address of Object.keys(knownEvmContracts)) {
      expect(() => getAddress(address)).not.toThrow()
    }
  })

  it('chain-scoped entries only reference real EvmChain members', () => {
    const validChains = new Set<string>(Object.values(EvmChain))
    for (const entry of Object.values(knownEvmContracts)) {
      if (!entry.chains) continue
      for (const chain of entry.chains) {
        expect(validChains.has(chain)).toBe(true)
      }
    }
  })

  it('every declared category is either used or explicitly reserved', () => {
    // Record<UnionType, …> over a manual array so adding a category to
    // KnownEvmContractCategory forces an explicit policy decision here at
    // compile time instead of silently passing.
    const categoryPolicy: Record<KnownEvmContractCategory, 'required' | 'reserved'> = {
      'DEX Router': 'required',
      'DEX Aggregator': 'required',
      'Token Approval Helper': 'required',
      'Cross-Chain Bridge': 'required',
      'Lending Protocol': 'required',
      // Reserved for future entries (OpenSea Seaport etc.) — not yet wired.
      'NFT Marketplace': 'reserved',
    }
    const used = new Set(Object.values(knownEvmContracts).map(e => e.category))
    // Single localized cast at the iteration boundary — the policy object's
    // keys are exactly KnownEvmContractCategory by construction.
    const categories = Object.keys(categoryPolicy) as KnownEvmContractCategory[]
    for (const category of categories) {
      if (categoryPolicy[category] === 'reserved') continue
      expect(used.has(category)).toBe(true)
    }
  })
})

describe('lookupKnownEvmContract', () => {
  const uniV2 = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d'
  const permit2 = '0x000000000022d473030f116ddee9f6b43ac78ba3'

  it('finds known addresses', () => {
    expect(lookupKnownEvmContract(uniV2)?.label).toBe('Uniswap V2 Router')
    expect(lookupKnownEvmContract(permit2)?.label).toBe('Permit2')
  })

  it('is case-insensitive', () => {
    expect(lookupKnownEvmContract(uniV2.toUpperCase())?.label).toBe('Uniswap V2 Router')
    expect(lookupKnownEvmContract(getAddress(uniV2))?.label).toBe('Uniswap V2 Router')
  })

  it('returns null for unknown addresses', () => {
    expect(lookupKnownEvmContract('0x000000000000000000000000000000000000dead')).toBeNull()
  })

  it('respects chain scoping when a chain is provided', () => {
    expect(lookupKnownEvmContract(uniV2, { chain: EvmChain.Ethereum })?.label).toBe('Uniswap V2 Router')
    // Same address, BSC isn't in the entry's chains list — should not match.
    expect(lookupKnownEvmContract(uniV2, { chain: EvmChain.BSC })).toBeNull()
  })

  it('ignores chain scoping for entries without a chains filter', () => {
    expect(lookupKnownEvmContract(permit2, { chain: EvmChain.Polygon })?.label).toBe('Permit2')
    expect(lookupKnownEvmContract(permit2, { chain: EvmChain.BSC })?.label).toBe('Permit2')
  })

  it('best-effort matches chain-scoped entries when no chain is supplied', () => {
    // Caller does not know which chain — return the label anyway. EVM
    // contract addresses are statistically unique per deploy.
    expect(lookupKnownEvmContract(uniV2)?.label).toBe('Uniswap V2 Router')
  })

  it('routes Base SwapRouter02 to the Base entry, not the multi-chain one', () => {
    // Regression: Uniswap V3 SwapRouter02 lives at a different address on
    // Base (0x2626…) than on Ethereum/Arbitrum/Optimism/Polygon (0x68b3…).
    // Don't claim 0x68b3… is Uniswap on Base — it's some other contract.
    const swapRouter02NonBase = '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45'
    const swapRouter02Base = '0x2626664c2603336e57b271c5c0b26f421741e481'

    expect(lookupKnownEvmContract(swapRouter02NonBase, { chain: EvmChain.Base })).toBeNull()
    expect(lookupKnownEvmContract(swapRouter02Base, { chain: EvmChain.Base })?.label).toBe('Uniswap V3 SwapRouter02')
    expect(lookupKnownEvmContract(swapRouter02Base, { chain: EvmChain.Ethereum })).toBeNull()
  })

  it('routes BSC and Avalanche SwapRouter02 to their per-chain entries', () => {
    // Each Uniswap V3 SwapRouter02 deployment is a separate entry — verify
    // the BSC and Avalanche addresses don't leak across chains.
    const swapRouter02Bsc = '0xb971ef87ede563556b2ed4b1c0b0019111dd85d2'
    const swapRouter02Avalanche = '0xbb00ff08d01d300023c629e8ffffcb65a5a578ce'

    expect(lookupKnownEvmContract(swapRouter02Bsc, { chain: EvmChain.BSC })?.label).toBe('Uniswap V3 SwapRouter02')
    expect(lookupKnownEvmContract(swapRouter02Bsc, { chain: EvmChain.Ethereum })).toBeNull()

    expect(lookupKnownEvmContract(swapRouter02Avalanche, { chain: EvmChain.Avalanche })?.label).toBe(
      'Uniswap V3 SwapRouter02'
    )
    expect(lookupKnownEvmContract(swapRouter02Avalanche, { chain: EvmChain.BSC })).toBeNull()
  })
})
