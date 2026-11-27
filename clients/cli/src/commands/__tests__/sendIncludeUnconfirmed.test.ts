import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CommandContext } from '../../core'
import { InvalidInputError } from '../../core/errors'
import { configureOutput, resetOutput } from '../../lib/output'
import { executeSend, sendTransaction } from '../transaction'

let stdout: string[]
let writeSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  stdout = []
  writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
    stdout.push(String(chunk))
    return true
  })
  process.env.VULTISIG_BROADCAST_JOURNAL_PATH = join(mkdtempSync(join(tmpdir(), 'send-unconfirmed-')), 'journal.json')
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
          fee: '0.00001',
          feeSymbol: 'BTC',
          total: '0.05001',
          keysignPayload: {
            coin: { isNativeToken: true, ticker: 'BTC', contractAddress: '', chain: 'Bitcoin', decimals: 8 },
            toAddress: 'bc1qrecipient',
            toAmount: '5000000',
            blockchainSpecific: { case: undefined },
          },
        }
      }
      return { dryRun: false as const, txHash: 'deadbeef'.repeat(8), chain: opts.chain }
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

describe('send --include-unconfirmed', () => {
  it('forwards includeUnconfirmed to the SDK in dry-run preview without a false confirmed-balance warning', async () => {
    const vault = makeBtcVault('0')
    configureOutput({ format: 'json' })

    await sendTransaction(vault, {
      chain: Chain.Bitcoin,
      to: 'bc1qrecipient',
      amount: '0.05',
      includeUnconfirmed: true,
      dryRun: true,
    })

    expect(vault.send).toHaveBeenCalledWith(
      expect.objectContaining({
        chain: Chain.Bitcoin,
        includeUnconfirmed: true,
        dryRun: true,
      })
    )
    expect(JSON.parse(stdout.join('')).data.warning).toBeUndefined()
  })

  it('forwards includeUnconfirmed to both dry-run and broadcast calls when confirmed', async () => {
    const vault = makeBtcVault('0')
    configureOutput({ format: 'json' })

    await sendTransaction(vault, {
      chain: Chain.Bitcoin,
      to: 'bc1qrecipient',
      amount: '0.05',
      includeUnconfirmed: true,
      yes: true,
    })

    expect(vault.send).toHaveBeenCalledTimes(2)
    expect(vault.send).toHaveBeenNthCalledWith(1, expect.objectContaining({ includeUnconfirmed: true, dryRun: true }))
    expect(vault.send).toHaveBeenNthCalledWith(2, expect.objectContaining({ includeUnconfirmed: true }))
  })

  it('keeps confirmed-balance warning and omits includeUnconfirmed by default', async () => {
    const vault = makeBtcVault('0')
    configureOutput({ format: 'json' })

    await sendTransaction(vault, {
      chain: Chain.Bitcoin,
      to: 'bc1qrecipient',
      amount: '0.05',
      dryRun: true,
    })

    expect(vault.send.mock.calls[0]?.[0]).not.toHaveProperty('includeUnconfirmed')
    expect(JSON.parse(stdout.join('')).data.warning).toMatch(/Insufficient balance/)
  })

  it.each([Chain.Ethereum, Chain.Cardano])('rejects --include-unconfirmed on non-UTXO chain %s', async chain => {
    const vault = makeBtcVault('1')
    const ctx = { ensureActiveVault: vi.fn().mockResolvedValue(vault) } as unknown as CommandContext

    await expect(
      executeSend(ctx, {
        chain,
        to: 'recipient',
        amount: '0.05',
        includeUnconfirmed: true,
        dryRun: true,
      })
    ).rejects.toThrow(InvalidInputError)
    expect(vault.send).not.toHaveBeenCalled()
  })

  it('supports --max with --include-unconfirmed in JSON dry-run preview without a false confirmed-balance warning', async () => {
    const vault = makeBtcVault('0')
    vault.send.mockResolvedValueOnce({
      dryRun: true as const,
      fee: '0.0001',
      feeSymbol: 'BTC',
      total: '0.6',
      keysignPayload: {
        coin: { isNativeToken: true, ticker: 'BTC', contractAddress: '', chain: 'Bitcoin', decimals: 8 },
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
      includeUnconfirmed: true,
      dryRun: true,
    })

    expect(vault.send).toHaveBeenCalledWith(
      expect.objectContaining({
        chain: Chain.Bitcoin,
        amount: 'max',
        includeUnconfirmed: true,
        dryRun: true,
      })
    )
    const preview = JSON.parse(stdout.join('')).data
    expect(preview.isMax).toBe(true)
    expect(preview.amount).toBe('0.5999')
    expect(preview.warning).toBeUndefined()
  })
})
