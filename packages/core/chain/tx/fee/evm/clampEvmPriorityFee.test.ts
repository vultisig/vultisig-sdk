import { EvmChain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { clampEvmPriorityFee, priorityFeeCeilingWeiByChain, priorityFeeFloorWeiByChain } from './clampEvmPriorityFee'

const gwei = (n: number) => BigInt(n) * 1_000_000_000n

describe('clampEvmPriorityFee', () => {
  it.each([
    ['Ethereum', EvmChain.Ethereum, gwei(80)], // heavy L1 congestion tip
    ['Polygon', EvmChain.Polygon, gwei(400)], // congestion spike
    ['Arbitrum', EvmChain.Arbitrum, gwei(1)], // typical L2 tip
    ['Base', EvmChain.Base, gwei(1)],
    ['Optimism', EvmChain.Optimism, gwei(1)],
    ['Blast', EvmChain.Blast, gwei(1)],
    ['Zksync', EvmChain.Zksync, gwei(1)],
    ['Mantle', EvmChain.Mantle, gwei(1)],
    ['Avalanche', EvmChain.Avalanche, gwei(25)],
    ['BSC', EvmChain.BSC, gwei(3)],
    ['CronosChain', EvmChain.CronosChain, gwei(5)],
    ['Hyperliquid', EvmChain.Hyperliquid, gwei(1)],
    ['Sei', EvmChain.Sei, gwei(5)],
  ])('passes a normal %s priority fee through unchanged (legit-path regression guard)', (_label, chain, fee) => {
    expect(clampEvmPriorityFee(chain, fee)).toBe(fee)
  })

  it.each([
    ['Ethereum', EvmChain.Ethereum, gwei(10_000)],
    ['Polygon', EvmChain.Polygon, gwei(50_000)],
    ['Arbitrum', EvmChain.Arbitrum, gwei(5_000)],
    ['Avalanche', EvmChain.Avalanche, gwei(10_000)],
    ['BSC', EvmChain.BSC, gwei(10_000)],
  ])(
    'clamps an absurdly inflated %s priority fee (compromised-RPC attack) to the sanity ceiling',
    (_label, chain, fee) => {
      const clamped = clampEvmPriorityFee(chain, fee)

      expect(clamped).toBeLessThan(fee)
      expect(clamped).toBeGreaterThan(0n)
    }
  )

  it('clamps a chain with the explicitly selected generous default ceiling', () => {
    const absurd = gwei(1_000_000)

    expect(clampEvmPriorityFee(EvmChain.Sei, absurd)).toBe(500n * 1_000_000_000n)
  })

  it('never clamps a fee that sits exactly at the ceiling', () => {
    expect(clampEvmPriorityFee(EvmChain.Ethereum, gwei(500))).toBe(gwei(500))
  })

  it('clamps a fee one wei above the ceiling', () => {
    const oneOverCeiling = gwei(500) + 1n

    expect(clampEvmPriorityFee(EvmChain.Ethereum, oneOverCeiling)).toBe(gwei(500))
  })

  it.each([
    ['near-zero quiet-market suggestion', 398_220n], // ~0.0004 gwei, observed live on api.vultisig.com/eth
    ['zero', 0n],
    ['one wei below the floor', gwei(1) - 1n],
  ])('floors an Ethereum tip too low to be mined (%s) to 1 gwei', (_label, fee) => {
    expect(clampEvmPriorityFee(EvmChain.Ethereum, fee)).toBe(gwei(1))
  })

  it('floors a Polygon tip below the validator-enforced minimum to 30 gwei', () => {
    expect(clampEvmPriorityFee(EvmChain.Polygon, gwei(1))).toBe(gwei(30))
  })

  it('never floors a fee that sits exactly at the floor', () => {
    expect(clampEvmPriorityFee(EvmChain.Ethereum, gwei(1))).toBe(gwei(1))
  })

  it.each([
    ['Arbitrum', EvmChain.Arbitrum],
    ['Base', EvmChain.Base],
    ['Optimism', EvmChain.Optimism],
    ['Zksync', EvmChain.Zksync],
  ])('passes a near-zero %s tip through unchanged (rollup sequencers ignore tips)', (_label, chain) => {
    const nearZero = 398_220n

    expect(clampEvmPriorityFee(chain, nearZero)).toBe(nearZero)
  })
})

// vultisig-sdk#1157: these tables are the exported canonical single source of
// truth for downstream per-chain gas-price floor/ceiling tables (app,
// agent-backend-ts). Assert their shape so a future refactor can't silently
// narrow them and break a consumer that reads the table directly instead of
// going through `clampEvmPriorityFee`.
describe('priorityFeeCeilingWeiByChain / priorityFeeFloorWeiByChain (public export)', () => {
  it('has a ceiling entry for every EvmChain, each a positive bigint', () => {
    const chains = Object.values(EvmChain)

    expect(Object.keys(priorityFeeCeilingWeiByChain).sort()).toEqual([...chains].sort())

    for (const chain of chains) {
      expect(typeof priorityFeeCeilingWeiByChain[chain]).toBe('bigint')
      expect(priorityFeeCeilingWeiByChain[chain]).toBeGreaterThan(0n)
    }
  })

  it('has floor entries only for tip-auction chains, each below its own ceiling', () => {
    expect(Object.keys(priorityFeeFloorWeiByChain).sort()).toEqual([EvmChain.Ethereum, EvmChain.Polygon].sort())

    for (const [chain, floor] of Object.entries(priorityFeeFloorWeiByChain) as [EvmChain, bigint][]) {
      expect(floor).toBeGreaterThan(0n)
      expect(floor).toBeLessThan(priorityFeeCeilingWeiByChain[chain])
    }
  })

  it('matches the documented Ethereum/Polygon floor values', () => {
    expect(priorityFeeFloorWeiByChain[EvmChain.Ethereum]).toBe(gwei(1))
    expect(priorityFeeFloorWeiByChain[EvmChain.Polygon]).toBe(gwei(30))
  })
})
