import type { Balance, Chain, FiatCurrency, Value, VaultBase } from '@vultisig/sdk'
import { Chain as ChainName } from '@vultisig/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CommandContext } from '../../core'
import { configureOutput, resetOutput } from '../../lib/output'
import { executePortfolio } from '../balance'
import { executeCurrency } from '../settings'

function makeBalance(): Balance {
  return {
    amount: '1000000000000000000',
    formattedAmount: '1.0',
    decimals: 18,
    symbol: 'ETH',
    chainId: ChainName.Ethereum,
  }
}

function makePortfolioCtx(currency: FiatCurrency) {
  const setCurrency = vi.fn(async () => {})
  const getValues = vi.fn(async (_chain: Chain, displayCurrency: FiatCurrency) => ({
    native: {
      amount: '10.00',
      currency: displayCurrency,
      lastUpdated: 0,
    } satisfies Value,
  }))
  const vault = {
    currency,
    chains: [ChainName.Ethereum],
    setCurrency,
    balance: vi.fn(async () => makeBalance()),
    getValues,
    getValue: vi.fn(),
  } as unknown as VaultBase

  return {
    ctx: { ensureActiveVault: async () => vault } as unknown as CommandContext,
    getValues,
    setCurrency,
  }
}

function captureStdout(): { output: () => string; restore: () => void } {
  const chunks: string[] = []
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
    chunks.push(String(chunk))
    return true
  })
  return { output: () => chunks.join(''), restore: () => spy.mockRestore() }
}

describe('portfolio display currency', () => {
  beforeEach(() => configureOutput({ format: 'json' }))

  afterEach(() => {
    resetOutput()
    vi.restoreAllMocks()
  })

  it('uses an explicit currency as a per-call display override without persisting it', async () => {
    const { ctx, getValues, setCurrency } = makePortfolioCtx('eur')
    const stdout = captureStdout()

    await executePortfolio(ctx, { currency: 'gbp' })

    const envelope = JSON.parse(stdout.output())
    stdout.restore()
    expect(setCurrency).not.toHaveBeenCalled()
    expect(getValues).toHaveBeenCalledWith(ChainName.Ethereum, 'gbp')
    expect(envelope.data.currency).toBe('gbp')
    expect(envelope.data.portfolio.totalValue.currency).toBe('gbp')
  })

  it('uses the stored preference when no display override is provided', async () => {
    const { ctx, getValues, setCurrency } = makePortfolioCtx('eur')
    const stdout = captureStdout()

    await executePortfolio(ctx)

    const envelope = JSON.parse(stdout.output())
    stdout.restore()
    expect(setCurrency).not.toHaveBeenCalled()
    expect(getValues).toHaveBeenCalledWith(ChainName.Ethereum, 'eur')
    expect(envelope.data.currency).toBe('eur')
    expect(envelope.data.portfolio.totalValue.currency).toBe('eur')
  })

  it('rejects an invalid display currency with the existing error', async () => {
    const { ctx, getValues, setCurrency } = makePortfolioCtx('eur')

    await expect(executePortfolio(ctx, { currency: 'xyz' as FiatCurrency })).rejects.toThrow('Invalid currency')
    expect(setCurrency).not.toHaveBeenCalled()
    expect(getValues).not.toHaveBeenCalled()
  })
})

describe('currency preference output', () => {
  beforeEach(() => configureOutput({ format: 'json' }))

  afterEach(() => {
    resetOutput()
    vi.restoreAllMocks()
  })

  it('emits the current preference envelope in JSON mode', async () => {
    const ctx = {
      ensureActiveVault: async () => ({ currency: 'eur' as FiatCurrency }),
    } as unknown as CommandContext
    const stdout = captureStdout()

    await executeCurrency(ctx)

    const envelope = JSON.parse(stdout.output())
    stdout.restore()
    expect(envelope).toMatchObject({
      success: true,
      v: 1,
      data: { currency: 'eur', name: 'Euro' },
    })
  })
})
