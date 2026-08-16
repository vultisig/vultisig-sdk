/**
 * Review fix (51exn): `recipientSanity` wires three flags (isNull, isSelfSend,
 * isMalformedEvm) into `sendTransaction`, but they are not the same kind of
 * problem. isNull and isMalformedEvm are unrecoverable / doomed sends and stay
 * hard refusals. isSelfSend is a legitimate operation (UTXO consolidation, a
 * 0-value EVM self-send to replace a stuck nonce) - it must WARN and fall
 * through to the existing --yes / interactive-confirm gate, not hard-throw.
 *
 * These tests pin that split:
 *   - self-send + --yes proceeds all the way to broadcast, with a warning printed.
 *   - self-send without --yes hits the pre-existing interactive confirm gate
 *     (declining still throws ConfirmationRequiredError - self-send never
 *     bypasses consent, it just stops being an unconditional wall).
 *   - isNull / isMalformedEvm still hard-refuse before any network call,
 *     regardless of --yes.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { KeysignPayload, VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/output', () => ({
  createSpinner: () => ({ succeed: vi.fn(), start: vi.fn(), stop: vi.fn(), fail: vi.fn(), text: '' }),
  info: vi.fn(),
  warn: vi.fn(),
  isNonInteractive: () => false,
  isJsonOutput: () => true,
  outputJson: vi.fn(),
}))
vi.mock('../../ui', () => ({
  confirmTransaction: vi.fn().mockResolvedValue(false),
  displayTransactionPreview: vi.fn(),
  displayTransactionResult: vi.fn(),
}))

import { ConfirmationRequiredError } from '../../core/errors'
import { outputJson, warn } from '../../lib/output'
import { confirmTransaction } from '../../ui'
import { sendTransaction } from '../transaction'

const OWNER = '0xEcdsaOwnerPubKey'
const SELF_ADDRESS = '0x1111111111111111111111111111111111111111'
const OTHER_ADDRESS = '0x2222222222222222222222222222222222222222'
const EVM_ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const MALFORMED_EVM_ADDRESS = '0xdeadbeef'
// A valid 32-byte Sui address: 0x + 64 hex chars (66 total) - NOT a valid 42-char
// EVM address, but a perfectly legitimate Sui recipient.
const VALID_SUI_ADDRESS = '0x1111111111111111111111111111111111111111111111111111111111111111'

function makeVault(address: string): VaultBase {
  const payload = {
    coin: { isNativeToken: true, ticker: 'ETH', contractAddress: '', chain: 'Ethereum', address },
    toAddress: address,
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
        : { dryRun: false, txHash: '0xbroadcast', chain: p.chain }
    ),
    gas: vi.fn().mockRejectedValue(new Error('no gas')),
    balance: vi.fn().mockResolvedValue({ symbol: 'ETH', decimals: 18, formattedAmount: '10' }),
    address: vi.fn().mockResolvedValue(address),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  } as unknown as VaultBase
}

// Journal isolation - sends that reach broadcast touch the persistent
// dedupe journal, same as sendSwapDupGuard.test.ts.
let home: string
let saved: string | undefined

beforeEach(() => {
  saved = process.env.VULTISIG_BROADCAST_JOURNAL_PATH
  home = mkdtempSync(join(tmpdir(), 'vultisig-recipientsanity-'))
  process.env.VULTISIG_BROADCAST_JOURNAL_PATH = join(home, 'broadcasts.jsonl')
})

afterEach(() => {
  if (saved === undefined) delete process.env.VULTISIG_BROADCAST_JOURNAL_PATH
  else process.env.VULTISIG_BROADCAST_JOURNAL_PATH = saved
  rmSync(home, { recursive: true, force: true })
  vi.clearAllMocks()
})

describe('recipientSanity wiring - isSelfSend is a warning, not a refusal', () => {
  it('self-send + --yes proceeds to broadcast and prints a self-send warning', async () => {
    const vault = makeVault(SELF_ADDRESS)

    const result = await sendTransaction(vault, {
      chain: Chain.Ethereum,
      to: SELF_ADDRESS,
      amount: '1',
      yes: true,
    })

    expect('txHash' in result && result.txHash).toBe('0xbroadcast')
    // The real broadcast leg omits `dryRun` entirely (only the preview leg sets it true).
    expect(vault.send).toHaveBeenCalledWith(expect.not.objectContaining({ dryRun: true }))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SELF-SEND'))
  })

  it('self-send without --yes hits the existing confirm gate - declining still refuses (never a silent bypass)', async () => {
    const vault = makeVault(SELF_ADDRESS)
    vi.mocked(confirmTransaction).mockResolvedValueOnce(false)

    const err = await sendTransaction(vault, { chain: Chain.Ethereum, to: SELF_ADDRESS, amount: '1' }).catch(e => e)

    expect(err).toBeInstanceOf(ConfirmationRequiredError)
    expect(vault.send).not.toHaveBeenCalledWith(expect.objectContaining({ dryRun: false }))
    // The warning still fires - self-send isn't silently allowed, it's surfaced then gated.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SELF-SEND'))
  })

  // JSON/CI callers set isJsonOutput() (see mock above), which makes `warn()` a
  // no-op (initOutputMode implies silentMode for JSON). Without threading the
  // warning into the JSON envelope too, a scripted caller silently lost the
  // self-send signal entirely - table mode warned, JSON mode said nothing.
  it('self-send + --yes surfaces the warning in the JSON result too, not just via warn()', async () => {
    const vault = makeVault(SELF_ADDRESS)

    const result = await sendTransaction(vault, {
      chain: Chain.Ethereum,
      to: SELF_ADDRESS,
      amount: '1',
      yes: true,
    })

    expect('warning' in result && result.warning).toEqual(expect.stringContaining('self-send'))
    expect(outputJson).toHaveBeenCalledWith(expect.objectContaining({ warning: expect.stringContaining('self-send') }))
  })

  it('a normal send to a different address never warns about self-send', async () => {
    const vault = makeVault(SELF_ADDRESS)

    await sendTransaction(vault, { chain: Chain.Ethereum, to: OTHER_ADDRESS, amount: '1', yes: true })

    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('SELF-SEND'))
  })
})

describe('recipientSanity wiring - isNull / isMalformedEvm stay hard refusals', () => {
  it('a null/burn recipient refuses before any network call, even with --yes', async () => {
    const vault = makeVault(OTHER_ADDRESS)

    const err = await sendTransaction(vault, {
      chain: Chain.Ethereum,
      to: EVM_ZERO_ADDRESS,
      amount: '1',
      yes: true,
    }).catch(e => e)

    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/Refusing send.*null \/ burn/)
    expect(vault.send).not.toHaveBeenCalled()
  })

  it('a malformed EVM recipient refuses before any network call, even with --yes', async () => {
    const vault = makeVault(OTHER_ADDRESS)

    const err = await sendTransaction(vault, {
      chain: Chain.Ethereum,
      to: MALFORMED_EVM_ADDRESS,
      amount: '1',
      yes: true,
    }).catch(e => e)

    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/Refusing send.*malformed EVM/)
    expect(vault.send).not.toHaveBeenCalled()
  })
})

describe('recipientSanity wiring - isMalformedEvm is chain-aware', () => {
  // Review fix: recipientSanity()'s isMalformedEvm flag is a pure 0x-shape check
  // (0x + hex, length != 42) with no chain context. A valid Sui address is ALSO
  // 0x-prefixed hex, just 66 chars (0x + 64 hex) instead of 42. Applying the EVM
  // rejection chain-agnostically hard-blocked every legitimate Sui send.
  it('a malformed-looking EVM string still refuses on an EVM chain', async () => {
    const vault = makeVault(OTHER_ADDRESS)

    const err = await sendTransaction(vault, {
      chain: Chain.Ethereum,
      to: MALFORMED_EVM_ADDRESS,
      amount: '1',
      yes: true,
    }).catch(e => e)

    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/Refusing send.*malformed EVM/)
    expect(vault.send).not.toHaveBeenCalled()
  })

  it('a valid 66-char Sui address is NOT rejected as malformed EVM on a Sui send', async () => {
    const vault = makeVault(OTHER_ADDRESS)

    const result = await sendTransaction(vault, {
      chain: Chain.Sui,
      to: VALID_SUI_ADDRESS,
      amount: '1',
      yes: true,
    })

    expect('txHash' in result && result.txHash).toBe('0xbroadcast')
    expect(vault.send).toHaveBeenCalled()
  })

  it('the same 66-char Sui-shaped string is still refused if sent on an EVM chain', async () => {
    const vault = makeVault(OTHER_ADDRESS)

    const err = await sendTransaction(vault, {
      chain: Chain.Ethereum,
      to: VALID_SUI_ADDRESS,
      amount: '1',
      yes: true,
    }).catch(e => e)

    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/Refusing send.*malformed EVM/)
    expect(vault.send).not.toHaveBeenCalled()
  })
})
