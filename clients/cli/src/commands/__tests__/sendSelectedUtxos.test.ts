import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CommandContext } from '../../core'
import { InvalidInputError } from '../../core/errors'
import { configureOutput, resetOutput } from '../../lib/output'
import { executeSend, parseUtxoSpec, parseUtxoSpecs, sendTransaction } from '../transaction'

let stdout: string[]
let writeSpy: ReturnType<typeof vi.spyOn>

const hashA = 'a1'.repeat(32)
const hashB = 'b2'.repeat(32)

beforeEach(() => {
  stdout = []
  writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
    stdout.push(String(chunk))
    return true
  })
  process.env.VULTISIG_BROADCAST_JOURNAL_PATH = join(mkdtempSync(join(tmpdir(), 'send-utxo-')), 'journal.json')
})

afterEach(() => {
  writeSpy.mockRestore()
  vi.restoreAllMocks()
  resetOutput()
})

const makeBtcVault = (confirmedBalance = '0') =>
  ({
    type: 'fast',
    id: 'vault-btc-1',
    name: 'BTC Vault',
    isEncrypted: false,
    isUnlocked: () => true,
    publicKeys: { ecdsa: '02ecdsa', eddsa: '' },
    on: vi.fn(() => () => {}),
    removeAllListeners: vi.fn(),
    send: vi.fn(async (opts: { dryRun?: boolean; chain: Chain }) => {
      if (opts.dryRun) {
        return {
          dryRun: true as const,
          fee: '0.0001',
          feeSymbol: 'BTC',
          total: '0.5501',
          keysignPayload: {
            coin: {
              isNativeToken: true,
              ticker: 'BTC',
              contractAddress: '',
              chain: 'Bitcoin',
              decimals: 8,
            },
            toAddress: 'bc1qrecipient',
            toAmount: '55000000',
            blockchainSpecific: { case: undefined },
          },
        }
      }
      return {
        dryRun: false as const,
        txHash: 'deadbeef'.repeat(8),
        chain: opts.chain,
      }
    }),
    balance: vi.fn(async () => ({
      formattedAmount: confirmedBalance,
      symbol: 'BTC',
      amount: '0',
      decimals: 8,
      chainId: 'bitcoin',
    })),
    gas: vi.fn(async () => ({})),
    address: vi.fn(async () => 'bc1qsender'),
  }) as unknown as VaultBase & { send: ReturnType<typeof vi.fn> }

describe('parseUtxoSpec / parseUtxoSpecs', () => {
  it('parses valid txid:vout:satoshis entries and normalizes uppercase txids', () => {
    expect(parseUtxoSpecs([`${hashA.toUpperCase()}:0:50000000`, `${hashB}:1:10000000`])).toEqual([
      { hash: hashA, index: 0, amount: 50_000_000n },
      { hash: hashB, index: 1, amount: 10_000_000n },
    ])
  })

  it.each([
    'missing-parts',
    `short:0:1000`,
    `0x${hashA}:0:1000`,
    `${hashA}:-1:1000`,
    `${hashA}:4294967296:1000`,
    `${hashA}:0:0`,
    `${hashA}:0:-5`,
    `${hashA}:0:9223372036854775808`,
  ])('rejects malformed --utxo entry %s', spec => {
    expect(() => parseUtxoSpec(spec)).toThrow(InvalidInputError)
  })

  it('rejects duplicate outpoints case-insensitively and empty arrays', () => {
    expect(() => parseUtxoSpecs([])).toThrow(InvalidInputError)
    expect(() => parseUtxoSpecs([`${hashA.toUpperCase()}:1:1000`, `${hashA}:1:1000`])).toThrow(InvalidInputError)
  })
})

describe('send --utxo', () => {
  const selectedUtxos = [
    { hash: hashA, index: 0, amount: 50_000_000n },
    { hash: hashB, index: 1, amount: 10_000_000n },
  ]

  it('forwards selectedUtxos in dry-run preview and checks affordability against the selected pool', async () => {
    const vault = makeBtcVault('0')
    configureOutput({ format: 'json' })

    await sendTransaction(vault, {
      chain: Chain.Bitcoin,
      to: 'bc1qrecipient',
      amount: '0.55',
      selectedUtxos,
      dryRun: true,
    })

    expect(vault.send).toHaveBeenCalledWith(
      expect.objectContaining({
        chain: Chain.Bitcoin,
        selectedUtxos,
        dryRun: true,
      })
    )
    const preview = JSON.parse(stdout.join('')).data
    expect(preview.balance).toBe('0.6')
    expect(preview.selectedUtxoCount).toBe(2)
    expect(preview.warning).toBeUndefined()
  })

  it('forwards selectedUtxos to both preview and broadcast calls when confirmed', async () => {
    const vault = makeBtcVault('0')
    configureOutput({ format: 'json' })

    await sendTransaction(vault, {
      chain: Chain.Bitcoin,
      to: 'bc1qrecipient',
      amount: '0.55',
      selectedUtxos,
      yes: true,
    })

    expect(vault.send).toHaveBeenCalledTimes(2)
    expect(vault.send).toHaveBeenNthCalledWith(1, expect.objectContaining({ selectedUtxos, dryRun: true }))
    expect(vault.send).toHaveBeenNthCalledWith(2, expect.objectContaining({ selectedUtxos }))
  })

  it('omits selectedUtxos and selectedUtxoCount when not provided', async () => {
    const vault = makeBtcVault('1')
    configureOutput({ format: 'json' })

    await sendTransaction(vault, {
      chain: Chain.Bitcoin,
      to: 'bc1qrecipient',
      amount: '0.55',
      dryRun: true,
    })

    expect(vault.send.mock.calls[0]?.[0]).not.toHaveProperty('selectedUtxos')
    expect(JSON.parse(stdout.join('')).data).not.toHaveProperty('selectedUtxoCount')
  })

  it.each([Chain.Ethereum, Chain.Cardano])('rejects --utxo on non-UTXO chain %s', async chain => {
    const vault = makeBtcVault('1')
    const ctx = {
      ensureActiveVault: vi.fn().mockResolvedValue(vault),
    } as unknown as CommandContext

    await expect(
      executeSend(ctx, {
        chain,
        to: 'recipient',
        amount: '0.55',
        selectedUtxos,
        dryRun: true,
      })
    ).rejects.toThrow(InvalidInputError)
    expect(vault.send).not.toHaveBeenCalled()
  })

  it('rejects empty selectedUtxos in executeSend', async () => {
    const vault = makeBtcVault('1')
    const ctx = {
      ensureActiveVault: vi.fn().mockResolvedValue(vault),
    } as unknown as CommandContext

    await expect(
      executeSend(ctx, {
        chain: Chain.Bitcoin,
        to: 'bc1qrecipient',
        amount: '0.55',
        selectedUtxos: [],
        dryRun: true,
      })
    ).rejects.toThrow(InvalidInputError)
    expect(vault.send).not.toHaveBeenCalled()
  })

  it('supports --max with --utxo in JSON dry-run preview', async () => {
    const vault = makeBtcVault('0')
    vault.send.mockResolvedValueOnce({
      dryRun: true as const,
      fee: '0.0001',
      feeSymbol: 'BTC',
      total: '0.6',
      keysignPayload: {
        coin: {
          isNativeToken: true,
          ticker: 'BTC',
          contractAddress: '',
          chain: 'Bitcoin',
          decimals: 8,
        },
        toAddress: 'bc1qrecipient',
        toAmount: '59990000',
        blockchainSpecific: { case: undefined },
      },
    })
    configureOutput({ format: 'json' })

    await sendTransaction(vault, {
      chain: Chain.Bitcoin,
      to: 'bc1qrecipient',
      amount: 'max',
      selectedUtxos,
      dryRun: true,
    })

    const preview = JSON.parse(stdout.join('')).data
    expect(preview.isMax).toBe(true)
    expect(preview.amount).toBe('0.5999')
    expect(preview.balance).toBe('0.6')
    expect(preview.selectedUtxoCount).toBe(2)
    expect(preview.warning).toBeUndefined()
  })

  it('warns when dry-run total exceeds the selected pool even if wallet confirmed balance is larger', async () => {
    const vault = makeBtcVault('5')
    configureOutput({ format: 'json' })

    await sendTransaction(vault, {
      chain: Chain.Bitcoin,
      to: 'bc1qrecipient',
      amount: '0.55',
      selectedUtxos: [{ hash: hashB, index: 1, amount: 10_000_000n }],
      dryRun: true,
    })

    const preview = JSON.parse(stdout.join('')).data
    expect(preview.balance).toBe('0.1')
    expect(preview.warning).toMatch(/Insufficient balance: you have 0\.1 BTC/)
  })

  it('displays selected UTXO count in human-readable dry-run preview', async () => {
    const vault = makeBtcVault('0')
    const logged: string[] = []
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '))
    })
    configureOutput({ format: 'table' })

    try {
      await sendTransaction(vault, {
        chain: Chain.Bitcoin,
        to: 'bc1qrecipient',
        amount: '0.55',
        selectedUtxos,
        dryRun: true,
      })
    } finally {
      logSpy.mockRestore()
    }

    expect(logged.join('\n')).toContain('UTXOs:   2 selected')
  })

  it('skips confirmed vault.balance reads on both dry-run preview and confirmed send when --utxo is set', async () => {
    const vault = makeBtcVault('0')
    ;(vault.balance as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Balance provider unavailable'))
    configureOutput({ format: 'json' })

    await sendTransaction(vault, {
      chain: Chain.Bitcoin,
      to: 'bc1qrecipient',
      amount: '0.55',
      selectedUtxos,
      dryRun: true,
    })

    const preview = JSON.parse(stdout.join('')).data
    expect(preview.balance).toBe('0.6')
    expect(preview.symbol).toBe('BTC')
    expect(vault.balance).not.toHaveBeenCalled()

    stdout = []
    await sendTransaction(vault, {
      chain: Chain.Bitcoin,
      to: 'bc1qrecipient',
      amount: '0.55',
      selectedUtxos,
      yes: true,
    })

    expect(vault.balance).not.toHaveBeenCalled()
    expect(JSON.parse(stdout.join('')).data.txHash).toBe('deadbeef'.repeat(8))
  })
})
