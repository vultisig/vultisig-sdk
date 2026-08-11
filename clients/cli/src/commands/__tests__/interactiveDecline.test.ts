/**
 * F1 (unit): declining at the interactive confirm prompt throws
 * `ConfirmationRequiredError` (exit 12) from every signing verb — send, execute,
 * swap — matching the non-interactive refusal. Before the fix each threw a plain
 * `Error('… cancelled by user')` that index.ts swallowed to exit 0, telling a
 * scripted caller a declined tx had "succeeded". These call the executors directly
 * with a fake vault (no network) and `confirmTransaction`/`confirmSwap` mocked to
 * decline. The end-to-end exit code (real withExit + a PTY) is in sendDeclinePty.test.ts.
 */
import type { KeysignPayload, VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/output', () => ({
  createSpinner: () => ({ succeed: vi.fn(), start: vi.fn(), stop: vi.fn(), fail: vi.fn(), text: '' }),
  info: vi.fn(),
  warn: vi.fn(),
  isNonInteractive: () => false,
  isJsonOutput: () => false,
  isSilent: () => false,
  outputJson: vi.fn(),
  printResult: vi.fn(),
}))
vi.mock('../../ui', () => ({
  confirmTransaction: vi.fn().mockResolvedValue(false),
  displayTransactionPreview: vi.fn(),
  displayTransactionResult: vi.fn(),
  confirmSwap: vi.fn().mockResolvedValue(false),
  displaySwapChains: vi.fn(),
  displaySwapPreview: vi.fn(),
  displaySwapResult: vi.fn(),
  formatBigintAmount: (v: bigint) => String(v),
}))

import { ConfirmationRequiredError, ExitCode } from '../../core/errors'
import { executeExecute } from '../execute'
import { executeSwap } from '../swap'
import { sendTransaction } from '../transaction'

const OWNER = '0xEcdsaOwnerPubKey'

function sendVault(): VaultBase {
  const payload = {
    coin: { isNativeToken: true, ticker: 'ETH', contractAddress: '', chain: 'Ethereum', address: '0xsender' },
    toAddress: '0xrecipient',
    toAmount: '1000000000000000000',
  } as unknown as KeysignPayload
  return {
    type: 'fast',
    isEncrypted: false,
    isUnlocked: () => true,
    unlock: vi.fn(),
    id: 'v-send',
    name: 'v-send',
    publicKeys: { ecdsa: OWNER, eddsa: '' },
    send: vi.fn(async (p: { dryRun?: boolean; chain: Chain }) =>
      p.dryRun
        ? { dryRun: true, fee: '0.001', total: '1', keysignPayload: payload }
        : { dryRun: false, txHash: '0xshouldnothappen', chain: p.chain }
    ),
    gas: vi.fn().mockRejectedValue(new Error('no gas')),
    balance: vi.fn().mockResolvedValue({ symbol: 'ETH', decimals: 18, formattedAmount: '10' }),
    address: vi.fn().mockResolvedValue('0xsender'),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  } as unknown as VaultBase
}

function swapVault(): VaultBase {
  const quote = {
    fromCoin: { decimals: 18, ticker: 'ETH' },
    toCoin: { decimals: 8, ticker: 'BTC' },
    estimatedOutput: 100n,
    maxSwapable: 0n,
    provider: 'thorchain',
  }
  return {
    type: 'fast',
    isEncrypted: false,
    isUnlocked: () => true,
    unlock: vi.fn(),
    id: 'v-swap',
    name: 'v-swap',
    publicKeys: { ecdsa: OWNER, eddsa: '' },
    swap: vi.fn(async (p: { dryRun?: boolean }) =>
      p.dryRun ? { dryRun: true, quote } : { dryRun: false, txHash: '0xshouldnothappen', chain: Chain.Ethereum, quote }
    ),
    balance: vi.fn().mockResolvedValue({ symbol: 'ETH', decimals: 18 }),
    getDiscountTier: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  } as unknown as VaultBase
}

function executeVault(): VaultBase {
  return {
    type: 'secure',
    isEncrypted: false,
    isUnlocked: () => true,
    unlock: vi.fn(),
    id: 'v-exec',
    name: 'v-exec',
    publicKeys: { ecdsa: OWNER, eddsa: '' },
    address: vi.fn().mockResolvedValue('thor1sender'),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  } as unknown as VaultBase
}

const expectDecline = (err: unknown) => {
  expect(err).toBeInstanceOf(ConfirmationRequiredError)
  expect((err as ConfirmationRequiredError).exitCode).toBe(ExitCode.CONFIRMATION_REQUIRED)
}

describe('interactive decline → ConfirmationRequiredError (exit 12)', () => {
  it('send: a declined confirm throws CONFIRMATION_REQUIRED and never broadcasts', async () => {
    const vault = sendVault()
    const err = await sendTransaction(vault, { chain: Chain.Ethereum, to: '0xrecipient', amount: '1' }).catch(e => e)
    expectDecline(err)
    // Only the dry-run ran — no real broadcast leg.
    expect(vault.send).not.toHaveBeenCalledWith(expect.objectContaining({ dryRun: false }))
  })

  it('swap: a declined confirm throws CONFIRMATION_REQUIRED and never broadcasts', async () => {
    const vault = swapVault()
    const ctx = { ensureActiveVault: async () => vault } as never
    const err = await executeSwap(ctx, {
      fromChain: Chain.Ethereum,
      toChain: Chain.Bitcoin,
      amount: 0.1,
    }).catch(e => e)
    expectDecline(err)
    expect(vault.swap).not.toHaveBeenCalledWith(expect.objectContaining({ dryRun: false }))
  })

  it('execute: a declined confirm throws CONFIRMATION_REQUIRED', async () => {
    const vault = executeVault()
    const ctx = { ensureActiveVault: async () => vault } as never
    const err = await executeExecute(ctx, {
      chain: Chain.THORChain,
      contract: 'thor1contract',
      msg: '{"swap":{}}',
    }).catch(e => e)
    expectDecline(err)
  })
})
