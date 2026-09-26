import { Chain } from '@vultisig/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

const makeTaoVault = () =>
  ({
    send: vi.fn(async () => ({
      dryRun: true,
      fee: '0.0002',
      feeSymbol: 'TAO',
      total: '1.0',
      keysignPayload: { coin: { decimals: 9 }, toAmount: '999800000', blockchainSpecific: { case: undefined } },
    })),
    balance: vi.fn(async () => ({
      formattedAmount: '1.0',
      symbol: 'TAO',
      amount: '0',
      decimals: 9,
      chainId: 'bittensor',
    })),
    gas: vi.fn(async () => ({})),
    address: vi.fn(async () => '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty'),
  }) as never

const params = {
  chain: Chain.Bittensor,
  to: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
  amount: 'max',
  allowDeath: true,
  dryRun: true,
} as never

describe('send --allow-death', () => {
  // The flag is what turns a keep-alive send into one the chain may reap, so
  // it has to reach the SDK, and the preview has to say what it does.
  it('passes the choice to the SDK and discloses the reap in the JSON preview', async () => {
    const vault = makeTaoVault()
    configureOutput({ format: 'json' })

    await sendTransaction(vault, params)

    expect((vault as { send: ReturnType<typeof vi.fn> }).send).toHaveBeenCalledWith(
      expect.objectContaining({ allowDeath: true, amount: 'max', dryRun: true })
    )
    expect(JSON.parse(stdout.join('')).data.warning).toMatch(/empties the account.*transfer_allow_death/)
  })

  it('does not disclose a reap for an ordinary send', async () => {
    const vault = makeTaoVault()
    configureOutput({ format: 'json' })

    await sendTransaction(vault, { ...(params as object), allowDeath: undefined } as never)

    expect(JSON.parse(stdout.join('')).data.warning).toBeUndefined()
  })
})
