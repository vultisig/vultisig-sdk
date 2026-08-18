import { readFileSync } from 'node:fs'

import type { Balance, Chain as ChainType, FiatCurrency, Value, VaultBase } from '@vultisig/sdk'
import { Chain, SUPPORTED_CHAINS } from '@vultisig/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CommandContext, PortfolioSummary } from '../core'
import { ExitCode, NetworkError } from '../core/errors'
import { configureOutput, resetOutput } from '../lib/output'
import { buildScopeHint, executeBalance, executePortfolio } from './balance'

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
  balance: (chain: ChainType, tokenId?: string) => Promise<Balance>
  getValue: (chain: ChainType, tokenId: string | undefined, currency: FiatCurrency) => Promise<Value>
  getValues?: (chain: ChainType, currency: FiatCurrency) => Promise<Record<string, Value>>
}

function makeCtx(overrides: VaultOverrides): CommandContext {
  const vault = {
    currency: 'usd' as FiatCurrency,
    chains: overrides.chains,
    setCurrency: vi.fn(async () => {}),
    balance: vi.fn(overrides.balance),
    getValue: vi.fn(overrides.getValue),
    getValues: vi.fn(
      overrides.getValues ??
        (async (chain: ChainType, currency: FiatCurrency) => ({
          native: await overrides.getValue(chain, undefined, currency),
        }))
    ),
  } as unknown as VaultBase

  return {
    ensureActiveVault: async () => vault,
  } as unknown as CommandContext
}

function captureStdout(): { calls: string[]; restore: () => void } {
  const calls: string[] = []
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
    calls.push(String(chunk))
    return true
  })
  return { calls, restore: () => spy.mockRestore() }
}

async function captureJson(run: () => Promise<void>) {
  const out = captureStdout()
  try {
    await run()
    return JSON.parse(out.calls.join(''))
  } finally {
    out.restore()
  }
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

  const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

  function sumBreakdown(chainBalances: PortfolioSummary['chainBalances']): number {
    return chainBalances.reduce(
      (sum, entry) =>
        sum +
        parseFloat(entry.value?.amount ?? '0') +
        (entry.tokens ?? []).reduce((tokenSum, token) => tokenSum + parseFloat(token.value.amount), 0),
      0
    )
  }

  it('reports a total equal to the sum of its own breakdown when a token is held', async () => {
    const ctx = makeCtx({
      chains: [Chain.Ethereum, Chain.Bitcoin],
      balance: async (chain, tokenId) => makeBalance(tokenId ? 'USDC' : chain === Chain.Bitcoin ? 'BTC' : 'ETH'),
      getValue: async () => makeValue('1.06'),
      getValues: async chain =>
        chain === Chain.Ethereum
          ? { native: makeValue('1.06'), [USDC]: makeValue('6.62') }
          : { native: makeValue('7.97') },
    })

    const { portfolio } = (await captureJson(() => executePortfolio(ctx, { currency: 'usd' }))).data as {
      portfolio: PortfolioSummary
    }
    expect(portfolio.totalValue.amount).toBe('15.65')
    expect(sumBreakdown(portfolio.chainBalances)).toBeCloseTo(parseFloat(portfolio.totalValue.amount), 2)
  })

  it('itemizes each held token with its own amount and value', async () => {
    const ctx = makeCtx({
      chains: [Chain.Ethereum],
      balance: async (_chain, tokenId) => makeBalance(tokenId ? 'USDC' : 'ETH'),
      getValue: async () => makeValue('1.06'),
      getValues: async () => ({ native: makeValue('1.06'), [USDC]: makeValue('6.62') }),
    })

    const { portfolio } = (await captureJson(() => executePortfolio(ctx, { currency: 'usd' }))).data as {
      portfolio: PortfolioSummary
    }
    expect(portfolio.chainBalances[0].tokens).toEqual([
      { tokenId: USDC, value: makeValue('6.62'), balance: makeBalance('USDC') },
    ])
  })

  it('still totals correctly when a chain drops out at the balance stage', async () => {
    const ctx = makeCtx({
      chains: [Chain.Ethereum, Chain.Bitcoin],
      balance: async chain => {
        if (chain === Chain.Bitcoin) throw new Error('btc down')
        return makeBalance('ETH')
      },
      getValue: async () => makeValue('1.06'),
      getValues: async () => ({ native: makeValue('1.06'), [USDC]: makeValue('6.62') }),
    })

    const { portfolio, failures } = (await captureJson(() => executePortfolio(ctx, { currency: 'usd' }))).data
    expect(portfolio.totalValue.amount).toBe('7.68')
    expect(sumBreakdown(portfolio.chainBalances)).toBeCloseTo(7.68, 2)
    expect(failures).toHaveLength(1)
  })

  it('recovers the real error message when getValues drops the native value', async () => {
    const ctx = makeCtx({
      chains: [Chain.Ethereum],
      balance: async () => makeBalance('ETH'),
      getValue: async () => {
        throw new Error('coingecko 429')
      },
      getValues: async () => ({ [USDC]: makeValue('6.62') }),
    })

    const { portfolio, failures } = (await captureJson(() => executePortfolio(ctx, { currency: 'usd' }))).data
    expect(failures).toEqual([{ chain: Chain.Ethereum, stage: 'value', error: 'coingecko 429' }])
    expect(portfolio.chainBalances[0].value).toBeUndefined()
    expect(portfolio.totalValue.amount).toBe('6.62')
  })

  it('renders one table row per priced asset, tokens included (human output)', async () => {
    configureOutput({ format: 'table', silent: false })
    let rows: Array<Record<string, string>> = []
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'table').mockImplementation((data: unknown) => {
      rows = data as Array<Record<string, string>>
    })

    const ctx = makeCtx({
      chains: [Chain.Ethereum],
      balance: async (_chain, tokenId) => makeBalance(tokenId ? 'USDC' : 'ETH'),
      getValue: async () => makeValue('1.06'),
      getValues: async () => ({ native: makeValue('1.06'), [USDC]: makeValue('6.62') }),
    })

    await executePortfolio(ctx, { currency: 'usd' })

    expect(rows.map(r => r.Symbol)).toEqual(['ETH', 'USDC'])
    expect(rows.map(r => r.Value)).toEqual(['1.06 USD', '6.62 USD'])
    expect(rows.every(r => r.Chain === Chain.Ethereum)).toBe(true)
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

describe('executeBalance honours --tokens on a single chain', () => {
  const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

  beforeEach(() => {
    configureOutput({ format: 'json' })
  })

  afterEach(() => {
    resetOutput()
    vi.restoreAllMocks()
  })

  function makeBalanceCtx() {
    const balances = vi.fn(async () => ({
      [Chain.Ethereum]: makeBalance('ETH'),
      [`${Chain.Ethereum}:${USDC}`]: makeBalance('USDC'),
    }))
    const balance = vi.fn(async () => makeBalance('ETH'))
    const vault = { balances, balance } as unknown as VaultBase
    return { ctx: { ensureActiveVault: async () => vault } as unknown as CommandContext, balances, balance }
  }

  it('returns token entries for one chain instead of dropping the flag', async () => {
    const { ctx, balances, balance } = makeBalanceCtx()

    const envelope = await captureJson(() => executeBalance(ctx, { chain: Chain.Ethereum, includeTokens: true }))
    expect(balances).toHaveBeenCalledWith([Chain.Ethereum], true)
    expect(balance).not.toHaveBeenCalled()
    const { balances: emitted } = envelope.data
    expect(Object.keys(emitted)).toContain(`${Chain.Ethereum}:${USDC}`)
  })

  it('leaves the native-only path untouched when --tokens is absent', async () => {
    const { ctx, balances, balance } = makeBalanceCtx()

    const envelope = await captureJson(() => executeBalance(ctx, { chain: Chain.Ethereum }))
    expect(balance).toHaveBeenCalledWith(Chain.Ethereum)
    expect(balances).not.toHaveBeenCalled()
    expect(envelope.data).toMatchObject({ chain: Chain.Ethereum, balance: { symbol: 'ETH' } })
  })
})

describe('aggregate scope hint (DF-02)', () => {
  // The aggregate `balance` / `portfolio` views iterate only enabled chains;
  // the hint is the honesty marker that says so. The scoped `balance <chain>`
  // path deliberately stays hint-free AND permissive (querying any
  // SDK-supported chain is the documented escape hatch — do not "fix" it).
  const allSupported = [...SUPPORTED_CHAINS]

  beforeEach(() => {
    configureOutput({ format: 'json' })
  })

  afterEach(() => {
    resetOutput()
    vi.restoreAllMocks()
  })

  function makeAggregateCtx(chains: ChainType[]) {
    const emitted = { [Chain.Ethereum]: makeBalance('ETH') }
    const vault = {
      chains,
      currency: 'usd' as FiatCurrency,
      setCurrency: vi.fn(async () => {}),
      balances: vi.fn(async () => emitted),
      balance: vi.fn(async () => makeBalance('ETH')),
      getValue: vi.fn(async () => makeValue('1.00')),
      getValues: vi.fn(async () => ({ native: makeValue('1.00') })),
    } as unknown as VaultBase
    return { ctx: { ensureActiveVault: async () => vault } as unknown as CommandContext, emitted }
  }

  it('puts the hint in its own JSON field on all-chains balance, leaving the balances payload unchanged', async () => {
    const { ctx, emitted } = makeAggregateCtx([Chain.Ethereum, Chain.Bitcoin])
    // Snapshot BEFORE the call: comparing against `emitted` itself would go
    // blind if the implementation mutated the map in place (e.g. wrote the
    // hint INTO it) — the reference and the expectation would drift together.
    const pristine = structuredClone(emitted)

    const envelope = await captureJson(() => executeBalance(ctx, {}))
    expect(envelope.data.scopeHint).toContain('2 enabled chains')
    // The machine-readable payload is byte-for-byte what the vault returned.
    expect(envelope.data.balances).toEqual(pristine)
    expect(emitted).toEqual(pristine)
  })

  it('omits the hint when every SDK-supported chain is enabled', async () => {
    const { ctx } = makeAggregateCtx(allSupported)

    const envelope = await captureJson(() => executeBalance(ctx, {}))
    expect(envelope.data.scopeHint).toBeUndefined()
  })

  it('adds the hint to the portfolio JSON envelope in its own field', async () => {
    const { ctx } = makeAggregateCtx([Chain.Ethereum])

    const envelope = await captureJson(() => executePortfolio(ctx, { currency: 'usd' }))
    expect(envelope.data.scopeHint).toContain('1 enabled chain of')
    expect(envelope.data.portfolio.chainBalances).toHaveLength(1)
    expect(envelope.data.failures).toEqual([])
  })

  it('keeps the scoped `balance <chain>` output hint-free (path unchanged)', async () => {
    const { ctx } = makeAggregateCtx([Chain.Ethereum])

    const scoped = await captureJson(() => executeBalance(ctx, { chain: Chain.Ethereum }))
    expect(scoped.data.scopeHint).toBeUndefined()
    expect(JSON.stringify(scoped)).not.toContain('enabled chain')

    const scopedTokens = await captureJson(() => executeBalance(ctx, { chain: Chain.Ethereum, includeTokens: true }))
    expect(scopedTokens.data.scopeHint).toBeUndefined()
  })

  it('prints the hint on the human-readable all-chains balance output', async () => {
    configureOutput({ format: 'table', silent: false })
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    })
    vi.spyOn(console, 'table').mockImplementation(() => {})

    const { ctx } = makeAggregateCtx([Chain.Ethereum, Chain.Bitcoin])
    await executeBalance(ctx, {})

    const joined = logs.join('\n')
    expect(joined).toContain("won't appear here")
    expect(joined).toContain('vultisig balance <chain>')
  })

  it('prints nothing extra on human output when every supported chain is enabled', async () => {
    // Guards the `if (scopeHint)` gate: without it, a suppressed hint would
    // print a stray "undefined" line after the table for fully-enabled vaults.
    configureOutput({ format: 'table', silent: false })
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    })
    vi.spyOn(console, 'table').mockImplementation(() => {})

    const { ctx } = makeAggregateCtx(allSupported)
    await executeBalance(ctx, {})

    const joined = logs.join('\n')
    expect(joined).not.toContain('undefined')
    expect(joined).not.toContain("won't appear here")
  })

  it('prints the hint on the human-readable portfolio output', async () => {
    configureOutput({ format: 'table', silent: false })
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    })
    vi.spyOn(console, 'table').mockImplementation(() => {})

    const { ctx } = makeAggregateCtx([Chain.Ethereum])
    await executePortfolio(ctx, { currency: 'usd' })

    expect(logs.join('\n')).toContain("won't appear here")
  })

  it('only names commands/flags that actually exist in the CLI definition (stale-hint guard)', async () => {
    // The hint's escape hatches must stay real: `vultisig balance <chain>` and
    // `vultisig chains --add <chain>`. If either registration disappears from
    // index.ts, this test — not a user — catches the stale pointer.
    const hint = buildScopeHint(1)
    expect(hint).toBeDefined()
    expect(hint).toContain('vultisig balance <chain>')
    expect(hint).toContain('vultisig chains --add <chain>')

    const indexSource = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
    expect(indexSource).toContain(".command('balance [chain]')")
    expect(indexSource).toContain(".command('chains')")
    expect(indexSource).toContain("'--add <chain>'")
  })

  it('pins the zero-enabled-chains wording (0 uses the plural noun)', () => {
    // A vault with no enabled chains still gets the hint (0 < supported), and
    // the plural branch must hold — "0 enabled chain" would read as a bug.
    const hint = buildScopeHint(0)
    expect(hint).toBe(
      `Showing the vault's 0 enabled chains of ${SUPPORTED_CHAINS.length} supported. ` +
        `Funds on other chains won't appear here — run \`vultisig balance <chain>\` to check one, ` +
        `or \`vultisig chains --add <chain>\` to include it.`
    )
  })

  it('never claims a scan it did not run (hint is static, no RPC)', () => {
    // buildScopeHint is a pure function of the enabled-chain count — feeding it
    // a count can't trigger network I/O, and the wording must not promise
    // discovered funds, only point at where to look.
    const hint = buildScopeHint(3)
    expect(hint).toBeDefined()
    expect(hint!.toLowerCase()).not.toContain('found')
    expect(hint!.toLowerCase()).not.toContain('detected')
  })
})
