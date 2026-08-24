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

function makeVault(opts: {
  fee: string
  total: string
  balance: string
  resolvedAmount?: string
  payloadMemo?: string
  payloadDestinationTag?: number
}) {
  return {
    send: vi.fn(async () => ({
      dryRun: true,
      fee: opts.fee,
      feeSymbol: 'ETH',
      total: opts.total,
      keysignPayload: {
        coin: { decimals: 18 },
        toAmount: opts.resolvedAmount ?? '1000000000000000000',
        memo: opts.payloadMemo,
        blockchainSpecific:
          opts.payloadDestinationTag === undefined
            ? { case: undefined, value: undefined }
            : {
                case: 'rippleSpecific',
                value: { destinationTag: opts.payloadDestinationTag },
              },
      },
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
  contractAddress?: string
}) {
  return {
    send: vi.fn(async () => ({
      dryRun: true,
      fee: opts.fee,
      feeSymbol: 'ETH',
      total: opts.total,
      contractAddress: opts.contractAddress,
      keysignPayload: {
        coin: { decimals: 6 },
        toAmount: '50000000',
      },
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
const memoParams = { ...(params as object), memo: 'memo-from-input' } as never

async function sendJson(vault: never, options: never = params) {
  stdout.length = 0
  configureOutput({ format: 'json' })
  await sendTransaction(vault, options)
  return JSON.parse(stdout.join('')).data
}

describe('send --dry-run preview', () => {
  it('discloses the exact token contract in JSON and the human preview', async () => {
    const contractAddress = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
    const vault = makeTokenVault({
      fee: '0.0021',
      total: '1.0',
      tokenBalance: '5.0',
      nativeBalance: '2.0',
      tokenSymbol: 'USDC.e',
      contractAddress,
    })

    expect((await sendJson(vault, tokenParams)).contractAddress).toBe(contractAddress)

    configureOutput({ format: 'table', silent: false })
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    })
    const result = (await sendTransaction(vault, tokenParams)) as SendDryRunResult

    expect(result.contractAddress).toBe(contractAddress)
    expect(logs.join('\n')).toContain(`Amount:  1.0 USDC.e (${contractAddress})`)
  })

  it('returns the fee and total the build produced', async () => {
    const result = (await sendTransaction(
      makeVault({ fee: '0.0021', total: '1.0021', balance: '5.0' }),
      params
    )) as SendDryRunResult

    expect(result.fee).toBe('0.0021')
    expect(result.total).toBe('1.0021')
    // Assert on the returned object, not JSON output: JSON.stringify drops
    // undefined-valued keys, so only this catches an unguarded
    // `contractAddress: undefined` leaking into the native-send result.
    expect(result).not.toHaveProperty('contractAddress')
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
    expect(data).not.toHaveProperty('contractAddress')
  })

  it('serializes the resolved amount and max flag for a max send', async () => {
    const data = await sendJson(
      makeVault({
        fee: '0.0021',
        total: '1.5021',
        balance: '2.0',
        resolvedAmount: '1500000000000000000',
      }),
      { ...(params as object), amount: 'max' } as never
    )

    expect(data.amount).toBe('1.5')
    expect(data.isMax).toBe(true)
  })

  it('leaves a non-max send amount unchanged and omits the max flag', async () => {
    const data = await sendJson(makeVault({ fee: '0.0021', total: '1.0021', balance: '5.0' }))

    expect(data.amount).toBe('1.0')
    expect(data).not.toHaveProperty('isMax')
  })

  it('leaves the human max-send preview unchanged', async () => {
    configureOutput({ format: 'table', silent: false })
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    })

    await sendTransaction(
      makeVault({ fee: '0.0021', total: '1.5021', balance: '2.0', resolvedAmount: '1500000000000000000' }),
      { ...(params as object), amount: 'max' } as never
    )

    expect(logs.join('\n')).toContain('Amount:  max ETH')
  })

  it('surfaces the signable payload memo in JSON instead of echoing the input', async () => {
    const vault = makeVault({
      fee: '0.0021',
      total: '1.0021',
      balance: '5.0',
      payloadMemo: 'memo-from-signable-payload',
    })
    const data = await sendJson(vault, memoParams)

    expect(data.memo).toBe('memo-from-signable-payload')
    expect(data.memo).not.toBe('memo-from-input')
    expect((vault as unknown as { send: ReturnType<typeof vi.fn> }).send).toHaveBeenCalledWith(
      expect.objectContaining({ memo: 'memo-from-input' })
    )
  })

  it('prints the signable payload memo and omits memo output for a memo-less payload', async () => {
    configureOutput({ format: 'table', silent: false })
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    })

    await sendTransaction(
      makeVault({
        fee: '0.0021',
        total: '1.0021',
        balance: '5.0',
        payloadMemo: 'memo-from-signable-payload',
      }),
      memoParams
    )

    const joined = logs.join('\n')
    expect(joined).toMatch(/Memo:\s+memo-from-signable-payload/)
    expect(joined).not.toContain('memo-from-input')

    logs.length = 0
    const memoLessResult = await sendTransaction(makeVault({ fee: '0.0021', total: '1.0021', balance: '5.0' }), params)

    expect(memoLessResult).not.toHaveProperty('memo')
    expect(logs.join('\n')).not.toMatch(/\bMemo:/)

    logs.length = 0
    const emptyMemoResult = await sendTransaction(
      makeVault({ fee: '0.0021', total: '1.0021', balance: '5.0', payloadMemo: '' }),
      params
    )

    expect(emptyMemoResult).not.toHaveProperty('memo')
    expect(logs.join('\n')).not.toMatch(/\bMemo:/)
  })

  it('reports XRP memo and destination-tag semantics from the signable payload', async () => {
    const classicAddress = 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY'
    const xAddress = 'XV5sbjUmgPpvXv4ixFWZ5ptAYZ6PD2q1qM6owqNbug8W6KV'
    const cases = [
      {
        name: 'numeric legacy memo',
        options: { chain: Chain.Ripple, to: classicAddress, amount: '1.0', memo: '12345', dryRun: true },
        payloadMemo: '12345',
        payloadDestinationTag: 12345,
        expectedMemo: undefined,
        expectedInputMemo: '12345',
        expectedInputTag: undefined,
        expectedTo: classicAddress,
      },
      {
        name: 'explicit destination tag only',
        options: { chain: Chain.Ripple, to: classicAddress, amount: '1.0', destinationTag: 12345, dryRun: true },
        payloadMemo: '12345',
        payloadDestinationTag: 12345,
        expectedMemo: undefined,
        expectedInputMemo: undefined,
        expectedInputTag: 12345,
        expectedTo: classicAddress,
      },
      {
        name: 'X-address embedded tag',
        options: { chain: Chain.Ripple, to: xAddress, amount: '1.0', dryRun: true },
        payloadMemo: '495',
        payloadDestinationTag: 495,
        expectedMemo: undefined,
        expectedInputMemo: undefined,
        expectedInputTag: 495,
        expectedTo: classicAddress,
      },
      {
        name: 'distinct numeric memo and destination tag',
        options: {
          chain: Chain.Ripple,
          to: classicAddress,
          amount: '1.0',
          memo: '67890',
          destinationTag: 12345,
          dryRun: true,
        },
        payloadMemo: '67890',
        payloadDestinationTag: 12345,
        expectedMemo: '67890',
        expectedInputMemo: '67890',
        expectedInputTag: 12345,
        expectedTo: classicAddress,
      },
    ] as const

    for (const testCase of cases) {
      const vault = makeVault({
        fee: '0.000015',
        total: '1.000015',
        balance: '5.0',
        payloadMemo: testCase.payloadMemo,
        payloadDestinationTag: testCase.payloadDestinationTag,
      })
      const data = await sendJson(vault, testCase.options as never)
      const payload = (vault as unknown as { send: ReturnType<typeof vi.fn> }).send.mock.results[0].value

      await expect(payload).resolves.toMatchObject({
        keysignPayload: {
          memo: testCase.payloadMemo,
          blockchainSpecific: {
            case: 'rippleSpecific',
            value: { destinationTag: testCase.payloadDestinationTag },
          },
        },
      })
      expect.soft(data.destinationTag, `${testCase.name}: destination tag`).toBe(testCase.payloadDestinationTag)
      expect.soft(data.memo, `${testCase.name}: memo`).toBe(testCase.expectedMemo)
      expect.soft(data.to, `${testCase.name}: destination address`).toBe(testCase.expectedTo)
      expect((vault as unknown as { send: ReturnType<typeof vi.fn> }).send).toHaveBeenCalledWith(
        expect.objectContaining({
          memo: testCase.expectedInputMemo,
          destinationTag: testCase.expectedInputTag,
        })
      )
    }
  })

  it('escapes terminal control bytes in the human memo while preserving JSON bytes', async () => {
    const payloadMemo = `literal\\x0A${String.fromCharCode(0, 10, 13, 27, 127, 155)}tail`
    const vault = makeVault({
      fee: '0.0021',
      total: '1.0021',
      balance: '5.0',
      payloadMemo,
    })

    expect((await sendJson(vault, memoParams)).memo).toBe(payloadMemo)

    configureOutput({ format: 'table', silent: false })
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    })
    await sendTransaction(vault, memoParams)

    const memoLine = logs.find(line => line.includes('Memo:'))
    expect(memoLine).toContain('literal\\\\x0A\\x00\\x0A\\x0D\\x1B\\x7F\\x9Btail')
    expect(memoLine).not.toContain(payloadMemo)
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

  it('does not perform the CLI native gas balance read for a max token send', async () => {
    const vault = makeTokenVault({ fee: '0.0001', total: '50.0', tokenBalance: '50.0', nativeBalance: '0.5' })

    expect(
      (
        await sendJson(vault, {
          ...(tokenParams as object),
          amount: 'max',
        } as never)
      ).warning
    ).toBeUndefined()
    expect((vault as unknown as { balance: ReturnType<typeof vi.fn> }).balance).toHaveBeenCalledTimes(1)
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
