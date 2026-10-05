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

function makePortfolioCtx(currency: string) {
  const setCurrency = vi.fn(async () => {})
  const getValuesDetailed = vi.fn(async (_chain: Chain, displayCurrency: FiatCurrency) => ({
    values: {
      native: {
        amount: '10.00',
        currency: displayCurrency,
        lastUpdated: 0,
      } satisfies Value,
    },
    failures: [],
  }))
  const vault = {
    currency,
    chains: [ChainName.Ethereum],
    tokens: {},
    setCurrency,
    balance: vi.fn(async () => makeBalance()),
    getValuesDetailed,
    getValue: vi.fn(),
  } as unknown as VaultBase

  return {
    ctx: { ensureActiveVault: async () => vault } as unknown as CommandContext,
    getValuesDetailed,
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
    const { ctx, getValuesDetailed, setCurrency } = makePortfolioCtx('eur')
    const stdout = captureStdout()

    await executePortfolio(ctx, { currency: 'gbp' })

    const envelope = JSON.parse(stdout.output())
    stdout.restore()
    expect(setCurrency).not.toHaveBeenCalled()
    expect(getValuesDetailed).toHaveBeenCalledWith(ChainName.Ethereum, 'gbp')
    expect(envelope.data.currency).toBe('gbp')
    expect(envelope.data.portfolio.totalValue.currency).toBe('gbp')
  })

  it('uses the stored preference when no display override is provided', async () => {
    const { ctx, getValuesDetailed, setCurrency } = makePortfolioCtx('eur')
    const stdout = captureStdout()

    await executePortfolio(ctx)

    const envelope = JSON.parse(stdout.output())
    stdout.restore()
    expect(setCurrency).not.toHaveBeenCalled()
    expect(getValuesDetailed).toHaveBeenCalledWith(ChainName.Ethereum, 'eur')
    expect(envelope.data.currency).toBe('eur')
    expect(envelope.data.portfolio.totalValue.currency).toBe('eur')
  })

  it('normalises an uppercase stored preference', async () => {
    const { ctx, getValuesDetailed, setCurrency } = makePortfolioCtx('EUR')
    const stdout = captureStdout()

    await executePortfolio(ctx)

    const envelope = JSON.parse(stdout.output())
    stdout.restore()
    expect(setCurrency).not.toHaveBeenCalled()
    expect(getValuesDetailed).toHaveBeenCalledWith(ChainName.Ethereum, 'eur')
    expect(envelope.data.portfolio.totalValue.currency).toBe('eur')
  })

  it('silently falls back to USD for an unsupported stored preference', async () => {
    const { ctx, getValuesDetailed, setCurrency } = makePortfolioCtx('xyz')
    const stdout = captureStdout()

    await expect(executePortfolio(ctx)).resolves.toBeUndefined()

    const envelope = JSON.parse(stdout.output())
    stdout.restore()
    expect(setCurrency).not.toHaveBeenCalled()
    expect(getValuesDetailed).toHaveBeenCalledWith(ChainName.Ethereum, 'usd')
    expect(envelope.data.portfolio.totalValue.currency).toBe('usd')
  })

  it('rejects an invalid display currency with the existing error', async () => {
    const { ctx, getValuesDetailed, setCurrency } = makePortfolioCtx('eur')

    await expect(executePortfolio(ctx, { currency: 'xyz' as FiatCurrency })).rejects.toThrow('Invalid currency')
    expect(setCurrency).not.toHaveBeenCalled()
    expect(getValuesDetailed).not.toHaveBeenCalled()
  })
})

describe('currency preference output', () => {
  beforeEach(() => configureOutput({ format: 'json' }))

  afterEach(() => {
    resetOutput()
    vi.restoreAllMocks()
  })

  it('normalises the stored preference in the current preference JSON envelope', async () => {
    const ctx = {
      ensureActiveVault: async () => ({ currency: 'EUR' }),
    } as unknown as CommandContext
    const stdout = captureStdout()

    await executeCurrency(ctx)

    const envelope = JSON.parse(stdout.output())
    stdout.restore()
    expect(envelope).toMatchObject({
      success: true,
      v: 1,
      data: { currency: 'eur', name: 'Euro', updated: false },
    })
  })
})
