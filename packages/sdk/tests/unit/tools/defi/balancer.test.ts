import { describe, expect, it } from 'vitest'

import { buildBalancerV3SwapCalldata } from '@/tools/defi/balancer'

// USDC -> USDT, single-hop, mainnet. Pool addr is a placeholder; the builder only
// encodes calldata, it never reads on-chain state.
const USDC = { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 }
const USDT = { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 }
const POOL = '0x1111111111111111111111111111111111111111'
const ACCOUNT = '0x2222222222222222222222222222222222222222'

const exactInPath = {
  pools: [POOL],
  tokens: [USDC, USDT],
  inputAmountRaw: 1_000_000n, // 1 USDC
  outputAmountRaw: 999_000n, // 0.999 USDT (quoted)
  isBuffer: [false],
}

describe('buildBalancerV3SwapCalldata', () => {
  it('builds unsigned EXACT_IN swap calldata with a slippage-bounded min out', () => {
    const tx = buildBalancerV3SwapCalldata({
      chainId: 1,
      swapKind: 'EXACT_IN',
      paths: [exactInPath],
      expectedAmountRaw: 999_000n,
      slippageBps: 50, // 0.5%
      recipient: ACCOUNT,
    })

    // Resolved to the Balancer v3 BatchRouter on mainnet.
    expect(tx.to.toLowerCase()).toBe('0xae563e3f8219521950555f5962419c8919758ea2')
    // swapExactIn selector.
    expect(tx.data.startsWith('0x750283bc')).toBe(true)
    expect(tx.value).toBe(0n)
    expect(tx.account).toBe(ACCOUNT)
    expect(tx.swapKind).toBe('EXACT_IN')
    // 999000 - 0.5% = 994005.
    expect(tx.minAmountOutRaw).toBe(994_005n)
    expect(tx.maxAmountInRaw).toBeUndefined()
  })

  it('builds unsigned EXACT_OUT swap calldata with a slippage-bounded max in', () => {
    const tx = buildBalancerV3SwapCalldata({
      chainId: 1,
      swapKind: 'EXACT_OUT',
      paths: [
        {
          pools: [POOL],
          tokens: [USDC, USDT],
          inputAmountRaw: 1_001_000n,
          outputAmountRaw: 1_000_000n, // want exactly 1 USDT out
          isBuffer: [false],
        },
      ],
      expectedAmountRaw: 1_001_000n, // quoted input
      slippageBps: 100, // 1%
      recipient: ACCOUNT,
    })

    expect(tx.to.toLowerCase()).toBe('0xae563e3f8219521950555f5962419c8919758ea2')
    expect(tx.swapKind).toBe('EXACT_OUT')
    // 1001000 + 1% = 1011010.
    expect(tx.maxAmountInRaw).toBe(1_011_010n)
    expect(tx.minAmountOutRaw).toBeUndefined()
  })

  it('passes through an injectable, consumer-owned userData (default 0x, never branded)', () => {
    const neutral = buildBalancerV3SwapCalldata({
      chainId: 1,
      swapKind: 'EXACT_IN',
      paths: [exactInPath],
      expectedAmountRaw: 999_000n,
      slippageBps: 50,
      recipient: ACCOUNT,
    })
    const withAffiliate = buildBalancerV3SwapCalldata({
      chainId: 1,
      swapKind: 'EXACT_IN',
      paths: [exactInPath],
      expectedAmountRaw: 999_000n,
      slippageBps: 50,
      recipient: ACCOUNT,
      userData: '0xdeadbeef',
    })
    // Injecting userData changes the encoded calldata — proof it's a real passthrough.
    expect(withAffiliate.data).not.toBe(neutral.data)
    expect(withAffiliate.data.includes('deadbeef')).toBe(true)
  })

  it('rejects malformed inputs', () => {
    expect(() =>
      buildBalancerV3SwapCalldata({
        chainId: 1,
        swapKind: 'EXACT_IN',
        paths: [exactInPath],
        expectedAmountRaw: 999_000n,
        slippageBps: 50,
        recipient: 'not-an-address',
      })
    ).toThrow(/recipient must be a valid/)

    expect(() =>
      buildBalancerV3SwapCalldata({
        chainId: 1,
        swapKind: 'EXACT_IN',
        paths: [{ ...exactInPath, pools: [POOL, POOL] }],
        expectedAmountRaw: 999_000n,
        slippageBps: 50,
        recipient: ACCOUNT,
      })
    ).toThrow(/pools\.length must equal tokens\.length - 1/)

    expect(() =>
      buildBalancerV3SwapCalldata({
        chainId: 1,
        swapKind: 'EXACT_IN',
        paths: [exactInPath],
        expectedAmountRaw: 999_000n,
        slippageBps: -1,
        recipient: ACCOUNT,
      })
    ).toThrow(/slippageBps must be a non-negative integer/)
  })
})
