import { describe, expect, it, vi } from 'vitest'

// Mock the EVM client factory so the unit test stays offline + deterministic.
// The real `getGasPrice()` hits an RPC; here we feed a fixed wei value and
// assert the wei→gwei conversion + shaping is correct.
const getGasPriceMock = vi.fn()
vi.mock('@vultisig/core-chain/chains/evm/client', () => ({
  getEvmClient: () => ({ getGasPrice: getGasPriceMock }),
}))

import { evmGasPrice } from '@/tools/evm/gasPrice'

describe('evmGasPrice', () => {
  it('returns the raw wei value untouched (exact bigint)', async () => {
    getGasPriceMock.mockResolvedValueOnce(12_345_678_901n)
    const result = await evmGasPrice('Ethereum')
    expect(result.chain).toBe('Ethereum')
    expect(result.gasPriceWei).toBe(12_345_678_901n)
  })

  it('converts wei → gwei rounded to 4 decimals', async () => {
    // 12_345_678_901 wei = 12.345678901 gwei → 12.3457
    getGasPriceMock.mockResolvedValueOnce(12_345_678_901n)
    const result = await evmGasPrice('Ethereum')
    expect(result.gasPriceGwei).toBe(12.3457)
  })

  it('handles whole-gwei values exactly', async () => {
    // 30 gwei
    getGasPriceMock.mockResolvedValueOnce(30_000_000_000n)
    const result = await evmGasPrice('Base')
    expect(result.gasPriceGwei).toBe(30)
    expect(result.gasPriceWei).toBe(30_000_000_000n)
  })

  it('handles sub-gwei (L2) gas prices without underflowing to 0', async () => {
    // 1_000_000 wei = 0.001 gwei
    getGasPriceMock.mockResolvedValueOnce(1_000_000n)
    const result = await evmGasPrice('Base')
    expect(result.gasPriceGwei).toBe(0.001)
  })

  it('clamps a non-zero price below the 4-decimal display floor UP, not down to 0', async () => {
    // 49_999 wei = 0.000049999 gwei → naive toFixed(4) rounds to 0.0000 → a "free gas" lie.
    // gasPriceWei must stay exact; gasPriceGwei must clamp to the smallest renderable value.
    getGasPriceMock.mockResolvedValueOnce(49_999n)
    const result = await evmGasPrice('Base')
    expect(result.gasPriceWei).toBe(49_999n)
    expect(result.gasPriceGwei).toBe(0.0001)
  })

  it('clamps a 1-wei dust price UP, never displaying 0 gwei for non-zero wei', async () => {
    getGasPriceMock.mockResolvedValueOnce(1n)
    const result = await evmGasPrice('Arbitrum')
    expect(result.gasPriceWei).toBe(1n)
    expect(result.gasPriceGwei).toBe(0.0001)
    expect(result.gasPriceGwei).not.toBe(0)
  })

  it('returns 0 gwei ONLY for a genuine 0 wei gas price', async () => {
    getGasPriceMock.mockResolvedValueOnce(0n)
    const result = await evmGasPrice('Arbitrum')
    expect(result.gasPriceWei).toBe(0n)
    expect(result.gasPriceGwei).toBe(0)
  })

  it('keeps the exact wei bigint beyond 2^53 (no JS-number precision loss)', async () => {
    // Astronomically high, but proves gasPriceWei never round-trips through a JS number.
    const huge = 123_456_789_012_345_678_901_234_567_890n
    getGasPriceMock.mockResolvedValueOnce(huge)
    const result = await evmGasPrice('Ethereum')
    expect(result.gasPriceWei).toBe(huge)
  })
})
