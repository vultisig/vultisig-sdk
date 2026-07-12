import { EvmChain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { clampEvmPriorityFee } from './clampEvmPriorityFee'

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

  it('clamps a chain without an explicit ceiling entry using the generous default', () => {
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
})
