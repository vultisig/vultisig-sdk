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

function makeTokenVault(opts: {
  fee: string
  total: string
  tokenBalance: string
  nativeBalance: string
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

async function sendJson(vault: never, options: never = params) {
  configureOutput({ format: 'json' })
  await sendTransaction(vault, options)
  return JSON.parse(stdout.join('')).data
}

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
    const data = await sendJson(makeVault({ fee: '0.0021', total: '1.0021', balance: '5.0' }))
    expect(data).toMatchObject({
      dryRun: true,
      chain: Chain.Ethereum,
      fee: '0.0021',
      total: '1.0021',
      balance: '5.0',
    })
  })

  it('still warns when the total exceeds the balance, and reports the numbers behind it', async () => {
    const data = await sendJson(makeVault({ fee: '0.5', total: '10.5', balance: '1.0' }))
    expect(data.warning).toMatch(/Insufficient balance/)
    expect(data.total).toBe('10.5')
    expect(data.balance).toBe('1.0')
  })

  it('does not warn when the balance covers the total', async () => {
    expect((await sendJson(makeVault({ fee: '0.0021', total: '1.0021', balance: '5.0' }))).warning).toBeUndefined()
  })
})

describe('send --dry-run preview — token sends', () => {
  it('carries feeSymbol into the JSON envelope', async () => {
    const data = await sendJson(
      makeTokenVault({ fee: '0.0001', total: '1.0', tokenBalance: '50.0', nativeBalance: '0.5' }),
      tokenParams
    )
    expect(data.feeSymbol).toBe('ETH')
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
    expect(joined).not.toMatch(/Fee:\s+0\.0001 USDC/)
  })

  it('warns when the native balance cannot cover the fee, even though the token balance is ample', async () => {
    const data = await sendJson(
      makeTokenVault({ fee: '0.0001', total: '1.0', tokenBalance: '50.0', nativeBalance: '0.00001' }),
      tokenParams
    )
    expect(data.warning).toMatch(/Insufficient ETH for the network fee/)
    expect(data.warning).not.toMatch(/Insufficient balance/)
  })

  it('does not warn about the fee when the native balance covers it', async () => {
    const vault = makeTokenVault({ fee: '0.0001', total: '1.0', tokenBalance: '50.0', nativeBalance: '0.5' })
    expect((await sendJson(vault, tokenParams)).warning).toBeUndefined()
  })

  it('reports both shortfalls when neither the token nor the gas balance is enough', async () => {
    const data = await sendJson(
      makeTokenVault({ fee: '0.0001', total: '100.0', tokenBalance: '5.0', nativeBalance: '0.00001' }),
      tokenParams
    )
    const { warning } = data
    expect(warning).toMatch(/Insufficient balance: you have 5\.0 USDC/)
    expect(warning).toMatch(/Insufficient ETH for the network fee/)
  })
})

describe('send --dry-run preview — fee asset identity', () => {
  it('checks the native balance for gas even when the token shares the native ticker', async () => {
    const data = await sendJson(
      makeTokenVault({
        fee: '0.001',
        total: '1.0',
        tokenBalance: '50.0',
        nativeBalance: '0.0',
        tokenSymbol: 'ETH',
      }),
      { ...(tokenParams as object), tokenId: '0xdeadbeef' } as never
    )
    expect(data.warning).toMatch(/Insufficient ETH for the network fee/)
  })

  it('does not double-report a native send whose balance is below the fee alone', async () => {
    const { warning } = await sendJson(makeVault({ fee: '5.0', total: '6.0', balance: '1.0' }))
    expect(warning).toMatch(/Insufficient balance/)
    expect(warning).not.toMatch(/network fee/)
  })

  it('says so when the gas balance cannot be read, instead of previewing clean', async () => {
    const vault = makeTokenVault({ fee: '0.0001', total: '1.0', tokenBalance: '50.0', nativeBalance: '0.5' })
    ;(vault as unknown as { balance: ReturnType<typeof vi.fn> }).balance = vi.fn(
      async (_chain: unknown, tokenId?: string) => {
        if (!tokenId) throw new Error('rpc down')
        return { formattedAmount: '50.0', symbol: 'USDC', amount: '0', decimals: 6, chainId: 'ethereum', tokenId }
      }
    )

    expect((await sendJson(vault, tokenParams)).warning).toMatch(/Could not check your ETH balance/)
  })
})
