// `send --dry-run` reports what the build actually cost (vultisig-sdk sdkcli2-13 P3-1).
//
// Regression guard: the SDK's dry-run returns { fee, total, keysignPayload }, and the
// human preview printed the fee — but the JSON result dropped fee and total entirely,
// so `--dry-run -o json` returned only amount/balance/chain/dryRun/symbol/to. It read
// as a bare balance check with no cost information, even though `total` is the very
// number the insufficient-balance warning compares against.
import { Chain } from '@vultisig/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SendDryRunResult } from '../../core'
import { configureOutput, resetOutput } from '../../lib/output'
import { sendTransaction } from '../transaction'

let stdout: string[]
let writeSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  stdout = []
  writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
    stdout.push(String(chunk))
    return true
  })
})

afterEach(() => {
  writeSpy.mockRestore()
  vi.restoreAllMocks()
  resetOutput()
})

function makeVault(opts: { fee: string; total: string; balance: string }) {
  return {
    send: vi.fn(async () => ({
      dryRun: true,
      fee: opts.fee,
      feeSymbol: 'ETH',
      total: opts.total,
      keysignPayload: { some: 'payload' },
    })),
    balance: vi.fn(async () => ({
      formattedAmount: opts.balance,
      symbol: 'ETH',
      amount: '0',
      decimals: 18,
      chainId: 'ethereum',
    })),
    gas: vi.fn(async () => ({})),
    address: vi.fn(async () => '0xfrom'),
  } as never
}

/**
 * A token send: the fee is paid in the chain's native asset, out of a DIFFERENT
 * balance than the asset being sent. `balance(chain, tokenId)` returns the
 * token; `balance(chain)` returns the native asset.
 */
function makeTokenVault(opts: {
  fee: string
  total: string
  tokenBalance: string
  nativeBalance: string
  /** Ticker the token reports. Defaults to USDC; set to 'ETH' to collide with the native ticker. */
  tokenSymbol?: string
}) {
  return {
    send: vi.fn(async () => ({
      dryRun: true,
      fee: opts.fee,
      feeSymbol: 'ETH',
      total: opts.total,
      keysignPayload: { some: 'payload' },
    })),
    balance: vi.fn(async (_chain: unknown, tokenId?: string) =>
      tokenId
        ? {
            formattedAmount: opts.tokenBalance,
            symbol: opts.tokenSymbol ?? 'USDC',
            amount: '0',
            decimals: 6,
            chainId: 'ethereum',
            tokenId,
          }
        : { formattedAmount: opts.nativeBalance, symbol: 'ETH', amount: '0', decimals: 18, chainId: 'ethereum' }
    ),
    gas: vi.fn(async () => ({})),
    address: vi.fn(async () => '0xfrom'),
  } as never
}

const params = {
  chain: Chain.Ethereum,
  to: '0xdead',
  amount: '1.0',
  dryRun: true,
} as never

const tokenParams = { ...(params as object), tokenId: 'USDC' } as never

describe('send --dry-run preview', () => {
  it('returns the fee and total the build produced', async () => {
    const result = (await sendTransaction(
      makeVault({ fee: '0.0021', total: '1.0021', balance: '5.0' }),
      params
    )) as SendDryRunResult

    expect(result.fee).toBe('0.0021')
    expect(result.total).toBe('1.0021')
  })

  it('carries fee and total into the JSON envelope, not just the human preview', async () => {
    configureOutput({ format: 'json' })

    await sendTransaction(makeVault({ fee: '0.0021', total: '1.0021', balance: '5.0' }), params)

    const data = JSON.parse(stdout.join('')).data
    expect(data).toMatchObject({
      dryRun: true,
      chain: Chain.Ethereum,
      fee: '0.0021',
      total: '1.0021',
      balance: '5.0',
    })
  })

  it('still warns when the total exceeds the balance, and reports the numbers behind it', async () => {
    configureOutput({ format: 'json' })

    await sendTransaction(makeVault({ fee: '0.5', total: '10.5', balance: '1.0' }), params)

    const data = JSON.parse(stdout.join('')).data
    expect(data.warning).toMatch(/Insufficient balance/)
    // The warning is only checkable by a caller if the numbers behind it are present.
    expect(data.total).toBe('10.5')
    expect(data.balance).toBe('1.0')
  })

  it('does not warn when the balance covers the total', async () => {
    configureOutput({ format: 'json' })

    await sendTransaction(makeVault({ fee: '0.0021', total: '1.0021', balance: '5.0' }), params)

    expect(JSON.parse(stdout.join('')).data.warning).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// A token send's fee comes out of the NATIVE balance, not the token's.
// ---------------------------------------------------------------------------

describe('send --dry-run preview — token sends', () => {
  it('carries feeSymbol into the JSON envelope', async () => {
    configureOutput({ format: 'json' })

    await sendTransaction(
      makeTokenVault({ fee: '0.0001', total: '1.0', tokenBalance: '50.0', nativeBalance: '0.5' }),
      tokenParams
    )

    // Without feeSymbol a caller cannot tell which asset `fee` is denominated
    // in — and for a token send it is NOT `symbol`.
    expect(JSON.parse(stdout.join('')).data.feeSymbol).toBe('ETH')
  })

  it('labels the fee with the native asset in the human preview, not the token being sent', async () => {
    configureOutput({ format: 'table', silent: false })
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    })

    await sendTransaction(
      makeTokenVault({ fee: '0.0001', total: '1.0', tokenBalance: '50.0', nativeBalance: '0.5' }),
      tokenParams
    )

    const joined = logs.join('\n')
    expect(joined).toMatch(/Fee:\s+0\.0001 ETH/)
    expect(joined).toMatch(/Amount:\s+1\.0 USDC/)
    // The fee line must never claim the fee is denominated in the token.
    expect(joined).not.toMatch(/Fee:\s+0\.0001 USDC/)
  })

  it('warns when the native balance cannot cover the fee, even though the token balance is ample', async () => {
    configureOutput({ format: 'json' })

    // 50 USDC on hand, sending 1 — but no ETH for gas. `total` is denominated in
    // USDC and clears its own balance check, so this is the only thing standing
    // between the user and a send that cannot land.
    await sendTransaction(
      makeTokenVault({ fee: '0.0001', total: '1.0', tokenBalance: '50.0', nativeBalance: '0.00001' }),
      tokenParams
    )

    const data = JSON.parse(stdout.join('')).data
    expect(data.warning).toMatch(/Insufficient ETH for the network fee/)
    expect(data.warning).not.toMatch(/Insufficient balance/)
  })

  it('does not warn about the fee when the native balance covers it', async () => {
    configureOutput({ format: 'json' })

    await sendTransaction(
      makeTokenVault({ fee: '0.0001', total: '1.0', tokenBalance: '50.0', nativeBalance: '0.5' }),
      tokenParams
    )

    expect(JSON.parse(stdout.join('')).data.warning).toBeUndefined()
  })

  it('reports both shortfalls when neither the token nor the gas balance is enough', async () => {
    configureOutput({ format: 'json' })

    await sendTransaction(
      makeTokenVault({ fee: '0.0001', total: '100.0', tokenBalance: '5.0', nativeBalance: '0.00001' }),
      tokenParams
    )

    const warning = JSON.parse(stdout.join('')).data.warning
    expect(warning).toMatch(/Insufficient balance: you have 5\.0 USDC/)
    expect(warning).toMatch(/Insufficient ETH for the network fee/)
  })
})

// ---------------------------------------------------------------------------
// Which balance pays the fee is decided by asset IDENTITY, not by ticker.
// ---------------------------------------------------------------------------

describe('send --dry-run preview — fee asset identity', () => {
  it('checks the native balance for gas even when the token shares the native ticker', async () => {
    configureOutput({ format: 'json' })

    // An ERC-20 whose symbol is literally "ETH" (they exist, and scam tokens
    // mimic deliberately) selected by contract address. Deciding the fee asset
    // by comparing tickers would compare the fee against this token's own
    // balance and report no shortfall for gas it cannot pay.
    await sendTransaction(
      makeTokenVault({
        fee: '0.001',
        total: '1.0',
        tokenBalance: '50.0',
        nativeBalance: '0.0',
        tokenSymbol: 'ETH',
      }),
      { ...(tokenParams as object), tokenId: '0xdeadbeef' } as never
    )

    expect(JSON.parse(stdout.join('')).data.warning).toMatch(/Insufficient ETH for the network fee/)
  })

  it('does not double-report a native send whose balance is below the fee alone', async () => {
    configureOutput({ format: 'json' })

    // A native send already carries the fee inside `total`, so the separate gas
    // check must not run — otherwise one shortfall is reported twice.
    await sendTransaction(makeVault({ fee: '5.0', total: '6.0', balance: '1.0' }), params)

    const warning = JSON.parse(stdout.join('')).data.warning
    expect(warning).toMatch(/Insufficient balance/)
    expect(warning).not.toMatch(/network fee/)
  })

  it('says so when the gas balance cannot be read, instead of previewing clean', async () => {
    configureOutput({ format: 'json' })

    const vault = makeTokenVault({ fee: '0.0001', total: '1.0', tokenBalance: '50.0', nativeBalance: '0.5' })
    // Token balance resolves; the native read for the gas check fails.
    ;(vault as unknown as { balance: ReturnType<typeof vi.fn> }).balance = vi.fn(
      async (_chain: unknown, tokenId?: string) => {
        if (!tokenId) throw new Error('rpc down')
        return { formattedAmount: '50.0', symbol: 'USDC', amount: '0', decimals: 6, chainId: 'ethereum', tokenId }
      }
    )

    await sendTransaction(vault, tokenParams)

    expect(JSON.parse(stdout.join('')).data.warning).toMatch(/Could not check your ETH balance/)
  })
})
