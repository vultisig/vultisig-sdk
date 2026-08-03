import type { VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/output', () => ({
  createSpinner: () => ({
    succeed: vi.fn(),
    stop: vi.fn(),
    fail: vi.fn(),
    text: '',
  }),
  info: vi.fn(),
  warn: vi.fn(),
  isNonInteractive: () => true,
  isJsonOutput: () => true,
  outputJson: vi.fn(),
}))
vi.mock('../ui', () => ({
  confirmSwap: vi.fn().mockResolvedValue(true),
  displaySwapChains: vi.fn(),
  displaySwapPreview: vi.fn(),
  displaySwapResult: vi.fn(),
  formatBigintAmount: (value: bigint) => String(value),
}))

import type { CommandContext } from '../core'
import { executeSwap, executeSwapQuote, normalizeSwapAmount } from './swap'

const exactAmount = '0.123456789123456789'

function makeContext() {
  const swap = vi.fn().mockResolvedValue({
    dryRun: true,
    quote: {
      fromCoin: { decimals: 18, ticker: 'ETH' },
      toCoin: { decimals: 8, ticker: 'BTC' },
      estimatedOutput: 100n,
      maxSwapable: 0n,
      provider: 'thorchain',
    },
  })
  const vault = { swap } as unknown as VaultBase
  const ctx = {
    ensureActiveVault: vi.fn().mockResolvedValue(vault),
  } as unknown as CommandContext
  return { ctx, swap }
}

describe('CLI swap amount precision', () => {
  it('preserves an exact decimal string in swap quote requests', async () => {
    const { ctx, swap } = makeContext()

    await executeSwapQuote(ctx, {
      fromChain: Chain.Ethereum,
      toChain: Chain.Bitcoin,
      amount: exactAmount,
    })

    expect(swap).toHaveBeenCalledWith(expect.objectContaining({ amount: exactAmount, dryRun: true }))
  })

  it('preserves an exact decimal string in swap dry-run requests and output', async () => {
    const { ctx, swap } = makeContext()

    const result = await executeSwap(ctx, {
      fromChain: Chain.Ethereum,
      toChain: Chain.Bitcoin,
      amount: exactAmount,
      dryRun: true,
    })

    expect(swap).toHaveBeenCalledWith(expect.objectContaining({ amount: exactAmount, dryRun: true }))
    expect(result).toMatchObject({ dryRun: true, inputAmount: exactAmount })
  })

  it.each([
    ['1', '1'],
    [' 1.0 ', '1'],
    ['1e0', '1'],
    ['+1e2', '100'],
    ['1.2300e-2', '0.0123'],
  ])('canonicalizes supported amount %j to %j', (amount, expected) => {
    expect(normalizeSwapAmount(amount)).toBe(expected)
  })

  it('uses the same canonical amount in swap requests and dry-run output', async () => {
    const { ctx, swap } = makeContext()

    const result = await executeSwap(ctx, {
      fromChain: Chain.Ethereum,
      toChain: Chain.Bitcoin,
      amount: ' 1.0e0 ',
      dryRun: true,
    })

    expect(swap).toHaveBeenCalledWith(expect.objectContaining({ amount: '1', dryRun: true }))
    expect(result).toMatchObject({ dryRun: true, inputAmount: '1' })
  })

  it('canonicalizes to the source token precision after quoting', async () => {
    const { ctx, swap } = makeContext()

    const result = await executeSwap(ctx, {
      fromChain: Chain.Ethereum,
      toChain: Chain.Bitcoin,
      amount: '1.0000000000000000009',
      dryRun: true,
    })

    expect(swap).toHaveBeenCalledWith(expect.objectContaining({ amount: '1.0000000000000000009', dryRun: true }))
    expect(result).toMatchObject({ dryRun: true, inputAmount: '1' })
  })

  it.each(['0', '0.0', '-1', '1oops', 'NaN', 'Infinity', '', '1e10001'])(
    'rejects invalid amount %j before vault access',
    async amount => {
      const { ctx, swap } = makeContext()

      await expect(
        executeSwap(ctx, {
          fromChain: Chain.Ethereum,
          toChain: Chain.Bitcoin,
          amount,
          dryRun: true,
        })
      ).rejects.toThrow('Invalid amount')

      expect(ctx.ensureActiveVault).not.toHaveBeenCalled()
      expect(swap).not.toHaveBeenCalled()
    }
  )
})
