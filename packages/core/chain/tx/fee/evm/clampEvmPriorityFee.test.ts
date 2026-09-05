import { EvmChain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { clampEvmPriorityFee } from './clampEvmPriorityFee'

const gwei = (n: number) => BigInt(n) * 1_000_000_000n

describe('clampEvmPriorityFee', () => {
  it.each([
    ['Ethereum', EvmChain.Ethereum, gwei(80)], // heavy L1 congestion tip
    ['Polygon', EvmChain.Polygon, gwei(400)], // congestion spike
    ['Base', EvmChain.Base, gwei(1)],
    ['Optimism', EvmChain.Optimism, gwei(1)],
    ['Blast', EvmChain.Blast, gwei(1)],
    ['Zksync', EvmChain.Zksync, gwei(1)],
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
    ['Optimism', EvmChain.Optimism, gwei(5_000)],
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

  it.each([
    ['BSC', EvmChain.BSC],
    ['CronosChain', EvmChain.CronosChain],
    ['Hyperliquid', EvmChain.Hyperliquid],
    ['Sei', EvmChain.Sei],
  ])('floors a near-zero %s tip to 1 gwei like Ethereum', (_label, chain) => {
    expect(clampEvmPriorityFee(chain, 398_220n)).toBe(gwei(1))
  })

  it('floors a Polygon tip below the validator-enforced minimum to 30 gwei', () => {
    expect(clampEvmPriorityFee(EvmChain.Polygon, gwei(1))).toBe(gwei(30))
  })

  it('never floors a fee that sits exactly at the floor', () => {
    expect(clampEvmPriorityFee(EvmChain.Ethereum, gwei(1))).toBe(gwei(1))
  })

  it.each([
    ['Base', EvmChain.Base],
    ['Optimism', EvmChain.Optimism],
    ['Blast', EvmChain.Blast],
  ])('floors a zero %s tip to a nominal 20 wei', (_label, chain) => {
    expect(clampEvmPriorityFee(chain, 0n)).toBe(20n)
    expect(clampEvmPriorityFee(chain, 21n)).toBe(21n)
  })

  it.each([
    ['Zksync', EvmChain.Zksync],
    ['Avalanche', EvmChain.Avalanche],
  ])('passes a near-zero %s tip through unchanged', (_label, chain) => {
    const nearZero = 398_220n

    expect(clampEvmPriorityFee(chain, nearZero)).toBe(nearZero)
  })

  it.each([
    ['Arbitrum', EvmChain.Arbitrum],
    ['Mantle', EvmChain.Mantle],
    ['Robinhood', EvmChain.Robinhood],
  ])('signs a zero %s tip whatever the RPC suggests (sequencer ignores tips)', (_label, chain) => {
    expect(clampEvmPriorityFee(chain, gwei(1))).toBe(0n)
    expect(clampEvmPriorityFee(chain, gwei(5_000))).toBe(0n)
  })
})
