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

const params = {
  chain: Chain.Ethereum,
  to: '0xdead',
  amount: '1.0',
  dryRun: true,
} as never

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
