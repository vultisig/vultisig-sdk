import type { Balance, Chain as ChainType, FiatCurrency, Value, VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CommandContext } from '../core'
import { ExitCode, NetworkError } from '../core/errors'
import { configureOutput, resetOutput } from '../lib/output'
import { executePortfolio } from './balance'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeBalance(symbol: string): Balance {
  return {
    amount: '1000000000000000000',
    formattedAmount: '1.0',
    decimals: 18,
    symbol,
    chainId: symbol.toLowerCase(),
  }
}

function makeValue(amount: string, currency: FiatCurrency = 'usd'): Value {
  return { amount, currency, lastUpdated: 0 }
}

type VaultOverrides = {
  chains: ChainType[]
  balance: (chain: ChainType) => Promise<Balance>
  getValue: (chain: ChainType, tokenId: string | undefined, currency: FiatCurrency) => Promise<Value>
  getTotalValue?: (currency: FiatCurrency) => Promise<Value>
}

function makeCtx(overrides: VaultOverrides): CommandContext {
  const vault = {
    currency: 'usd' as FiatCurrency,
    chains: overrides.chains,
    setCurrency: vi.fn(async () => {}),
    getTotalValue: overrides.getTotalValue ?? (async () => makeValue('42.00')),
    balance: vi.fn(overrides.balance),
    getValue: vi.fn(overrides.getValue),
  } as unknown as VaultBase

  return {
    ensureActiveVault: async () => vault,
  } as unknown as CommandContext
}

// Capture the JSON envelope written to stdout by `outputJson`.
function captureStdout(): { calls: string[]; restore: () => void } {
  const calls: string[] = []
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
    calls.push(String(chunk))
    return true
  })
  return { calls, restore: () => spy.mockRestore() }
}

// ---------------------------------------------------------------------------

describe('executePortfolio partial-failure reporting', () => {
  beforeEach(() => {
    configureOutput({ format: 'json' })
  })

  afterEach(() => {
    resetOutput()
    vi.restoreAllMocks()
  })

  it('returns healthy chains and lists a balance-stage failure instead of failing the whole command', async () => {
    // One chain throws in balance() — the pre-fix code called balance() outside
    // the per-chain try, so a single throw rejected Promise.all and failed the
    // entire portfolio command. The fix must keep the good chains and record the
    // bad one in `failures`.
    const ctx = makeCtx({
      chains: [Chain.Ethereum, Chain.Bitcoin],
      balance: async chain => {
        if (chain === Chain.Bitcoin) throw new Error('ECONNREFUSED btc-rpc')
        return makeBalance('ETH')
      },
      getValue: async () => makeValue('100.00'),
    })

    const out = captureStdout()
    await executePortfolio(ctx, { currency: 'usd' })
    out.restore()

    const envelope = JSON.parse(out.calls.join(''))
    expect(envelope.success).toBe(true)
    const { portfolio, failures } = envelope.data

    expect(portfolio.chainBalances).toHaveLength(1)
    expect(portfolio.chainBalances[0].chain).toBe(Chain.Ethereum)

    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ chain: Chain.Bitcoin, stage: 'balance' })
    expect(failures[0].error).toContain('ECONNREFUSED')
  })

  it('keeps a chain balance but records a value-stage failure when getValue throws', async () => {
    // Pre-fix, a getValue() throw was swallowed by a bare `catch {}` — the entry
    // silently lost its fiat value with no marker. The fix keeps the balance AND
    // surfaces the failure.
    const ctx = makeCtx({
      chains: [Chain.Ethereum],
      balance: async () => makeBalance('ETH'),
      getValue: async () => {
        throw new Error('pricing service unavailable')
      },
    })

    const out = captureStdout()
    await executePortfolio(ctx, { currency: 'usd' })
    out.restore()

    const { portfolio, failures } = JSON.parse(out.calls.join('')).data
    expect(portfolio.chainBalances).toHaveLength(1)
    expect(portfolio.chainBalances[0].value).toBeUndefined()
    expect(failures).toEqual([{ chain: Chain.Ethereum, stage: 'value', error: 'pricing service unavailable' }])
  })

  it('emits an empty failures array (stable schema) when everything succeeds', async () => {
    const ctx = makeCtx({
      chains: [Chain.Ethereum, Chain.Solana],
      balance: async () => makeBalance('X'),
      getValue: async () => makeValue('10.00'),
    })

    const out = captureStdout()
    await executePortfolio(ctx, { currency: 'usd' })
    out.restore()

    const { portfolio, failures } = JSON.parse(out.calls.join('')).data
    expect(portfolio.chainBalances).toHaveLength(2)
    expect(failures).toEqual([])
  })

  it('throws a NetworkError (non-zero exit) when every chain fails to fetch a balance', async () => {
    const ctx = makeCtx({
      chains: [Chain.Ethereum, Chain.Bitcoin],
      balance: async () => {
        throw new Error('fetch failed')
      },
      getValue: async () => makeValue('0.00'),
    })

    const err = await executePortfolio(ctx, { currency: 'usd' }).catch(e => e)
    expect(err).toBeInstanceOf(NetworkError)
    expect((err as NetworkError).exitCode).toBe(ExitCode.NETWORK)
  })

  it('produces a single parseable envelope with no stack traces in the failure message', async () => {
    const boom = new Error('boom')
    // A real Error carries a multi-line stack; the envelope must only surface the
    // concise single-line message.
    const ctx = makeCtx({
      chains: [Chain.Ethereum, Chain.Bitcoin],
      balance: async chain => {
        if (chain === Chain.Bitcoin) throw boom
        return makeBalance('ETH')
      },
      getValue: async () => makeValue('5.00'),
    })

    const out = captureStdout()
    await executePortfolio(ctx, { currency: 'usd' })
    out.restore()

    const raw = out.calls.join('')
    // Exactly one JSON document on stdout.
    expect(() => JSON.parse(raw)).not.toThrow()
    const { failures } = JSON.parse(raw).data
    expect(failures[0].error).toBe('boom')
    expect(failures[0].error).not.toContain('\n')
    expect(raw).not.toContain('at Object.') // no stack frames leaked
  })

  it('preserves chains order across chainBalances and failures for a mixed balance+value failure run', async () => {
    // Interleaved: chain[0] fails at balance, chain[1] is healthy, chain[2] fails
    // at value. Proves (a) both arrays track `chains` order, and (b) balance-stage
    // and value-stage failures are handled together in a single run.
    const ctx = makeCtx({
      chains: [Chain.Bitcoin, Chain.Ethereum, Chain.Solana],
      balance: async chain => {
        if (chain === Chain.Bitcoin) throw new Error('btc balance down')
        return makeBalance(chain === Chain.Ethereum ? 'ETH' : 'SOL')
      },
      getValue: async chain => {
        if (chain === Chain.Solana) throw new Error('sol price down')
        return makeValue('100.00')
      },
    })

    const out = captureStdout()
    await executePortfolio(ctx, { currency: 'usd' })
    out.restore()

    const { portfolio, failures } = JSON.parse(out.calls.join('')).data
    // Ethereum (ok, with value) then Solana (kept, value dropped) — Bitcoin omitted.
    expect(portfolio.chainBalances.map((c: { chain: string }) => c.chain)).toEqual([Chain.Ethereum, Chain.Solana])
    expect(portfolio.chainBalances[0].value).toBeDefined()
    expect(portfolio.chainBalances[1].value).toBeUndefined()
    // Failures preserve chains order: Bitcoin (balance) before Solana (value).
    expect(failures).toEqual([
      { chain: Chain.Bitcoin, stage: 'balance', error: 'btc balance down' },
      { chain: Chain.Solana, stage: 'value', error: 'sol price down' },
    ])
  })

  it('collapses a multi-line error MESSAGE to its first line (conciseError, head-on)', async () => {
    // Unlike test 5 (newline only on .stack), here the message itself is multi-line.
    const ctx = makeCtx({
      chains: [Chain.Ethereum],
      balance: async () => {
        throw new Error('primary failure line\n  secondary detail\n  /Users/secret/path/leak')
      },
      getValue: async () => makeValue('0.00'),
    })

    const err = await executePortfolio(ctx, { currency: 'usd' }).catch(e => e)
    // Single chain, all-fail → NetworkError; the concise message must be line 1 only.
    expect(err).toBeInstanceOf(NetworkError)
    expect((err as NetworkError).message).toContain('primary failure line')
    expect((err as NetworkError).message).not.toContain('secondary detail')
    expect((err as NetworkError).message).not.toContain('/Users/secret/path/leak')
  })

  it('prints per-chain warnings on the human-readable (table) output', async () => {
    configureOutput({ format: 'table', silent: false })
    const logs: string[] = []
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    })
    // Silence console.table noise from the portfolio breakdown.
    const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {})

    const ctx = makeCtx({
      chains: [Chain.Ethereum, Chain.Bitcoin],
      balance: async chain => {
        if (chain === Chain.Bitcoin) throw new Error('btc unreachable')
        return makeBalance('ETH')
      },
      getValue: async () => makeValue('12.00'),
    })

    await executePortfolio(ctx, { currency: 'usd' })
    logSpy.mockRestore()
    tableSpy.mockRestore()

    const joined = logs.join('\n')
    expect(joined).toContain('failed to load fully')
    expect(joined).toContain('Bitcoin')
    expect(joined).toContain('btc unreachable')
  })
})
