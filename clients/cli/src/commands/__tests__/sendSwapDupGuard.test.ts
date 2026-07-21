/**
 * Broadcast dedupe guard on the direct `send` / `swap` commands (audit P5-1, HIGH).
 *
 * Before this fix the `send` / `swap` verbs called `vault.send()` / `vault.swap()`
 * straight through and never touched the persistent broadcast journal, so a retry
 * double-spent (two identical `send --confirm` both broadcast). These tests drive
 * `sendTransaction` / `executeSwap` against a real on-disk journal
 * (VULTISIG_BROADCAST_JOURNAL_PATH → temp file) and assert:
 *   - an identical second send/swap is REFUSED (no second broadcast), exit 9,
 *   - `--force` overrides,
 *   - a genuinely distinct intent is NOT blocked,
 *   - the guard is cross-process (the journal is file-backed) and cross-PATH: a
 *     `send` and an identical `agent ask` intent dedupe against the SAME journal.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { KeysignPayload, VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Keep the command output/UI silent and deterministic (JSON path, no spinners).
vi.mock('../../lib/output', () => ({
  createSpinner: () => ({ succeed: vi.fn(), stop: vi.fn(), fail: vi.fn(), text: '' }),
  info: vi.fn(),
  warn: vi.fn(),
  isNonInteractive: () => true,
  isJsonOutput: () => true,
  outputJson: vi.fn(),
}))
vi.mock('../../ui', () => ({
  confirmTransaction: vi.fn().mockResolvedValue(true),
  displayTransactionPreview: vi.fn(),
  displayTransactionResult: vi.fn(),
  confirmSwap: vi.fn().mockResolvedValue(true),
  displaySwapChains: vi.fn(),
  displaySwapPreview: vi.fn(),
  displaySwapResult: vi.fn(),
  formatBigintAmount: (v: bigint) => String(v),
}))

import { AgentErrorCode } from '../../agent/agentErrors'
import { computeFingerprint, reserveBroadcast } from '../../agent/broadcastJournal'
import { AgentExecutor } from '../../agent/executor'
import { buildSendBroadcastIntent } from '../../core/broadcastGuard'
import { classifyError, ExitCode } from '../../core/errors'
import { executeSwap } from '../swap'
import { sendTransaction } from '../transaction'

// ---- Fixtures --------------------------------------------------------------

const OWNER = '0xEcdsaOwnerPubKey'

function nativeSendPayload(to: string, amountBaseUnits: string): KeysignPayload {
  return {
    coin: { isNativeToken: true, ticker: 'ETH', contractAddress: '', chain: 'Ethereum', address: '0xsender' },
    toAddress: to,
    toAmount: amountBaseUnits,
    memo: undefined,
  } as unknown as KeysignPayload
}

function memoSendPayload(to: string, amountBaseUnits: string, memo: string): KeysignPayload {
  return {
    coin: { isNativeToken: true, ticker: 'RUNE', contractAddress: '', chain: 'THORChain', address: 'thor1sender' },
    toAddress: to,
    toAmount: amountBaseUnits,
    memo,
  } as unknown as KeysignPayload
}

function tokenSendPayload(to: string, amountBaseUnits: string, contract: string): KeysignPayload {
  return {
    coin: { isNativeToken: false, ticker: 'USDC', contractAddress: contract, chain: 'Ethereum', address: '0xsender' },
    toAddress: to,
    toAmount: amountBaseUnits,
    memo: undefined,
  } as unknown as KeysignPayload
}

/** A vault whose dry-run returns `payload`, but resolves a DIFFERENT amount each
 * real broadcast — models `--max` fee/balance drift between attempts. */
function makeDriftingMaxVault(opts: { payloads: KeysignPayload[]; txHash: string; realSends: { count: number } }): {
  vault: VaultBase
} {
  let dry = 0
  const send = vi.fn(async (p: { dryRun?: boolean; chain: Chain }) => {
    if (p.dryRun) {
      const payload = opts.payloads[Math.min(dry, opts.payloads.length - 1)]
      dry += 1
      return { dryRun: true, fee: '0.001', total: '1', keysignPayload: payload }
    }
    opts.realSends.count += 1
    return { dryRun: false, txHash: opts.txHash, chain: p.chain }
  })
  return {
    vault: {
      type: 'fast',
      isEncrypted: false,
      isUnlocked: () => true,
      unlock: vi.fn(),
      id: 'vault-max',
      name: 'vault-max',
      publicKeys: { ecdsa: OWNER, eddsa: '' },
      send,
      gas: vi.fn().mockRejectedValue(new Error('no gas')),
      balance: vi.fn().mockResolvedValue({ symbol: 'ETH', decimals: 18, formattedAmount: '10' }),
      address: vi.fn().mockResolvedValue('0xsender'),
      on: vi.fn(),
      removeAllListeners: vi.fn(),
    } as unknown as VaultBase,
  }
}

/** A vault whose `send` returns a dry-run payload, then a broadcast hash. */
function makeSendVault(opts: {
  ecdsa?: string
  payload: KeysignPayload
  txHash: string
  realSends: { count: number }
}): VaultBase {
  const send = vi.fn(async (p: { dryRun?: boolean; chain: Chain }) => {
    if (p.dryRun) return { dryRun: true, fee: '0.001', total: '1.001', keysignPayload: opts.payload }
    opts.realSends.count += 1
    return { dryRun: false, txHash: opts.txHash, chain: p.chain }
  })
  return {
    type: 'fast',
    isEncrypted: false,
    isUnlocked: () => true,
    unlock: vi.fn(),
    id: 'vault-send',
    name: 'vault-send',
    publicKeys: { ecdsa: opts.ecdsa ?? OWNER, eddsa: '' },
    send,
    gas: vi.fn().mockRejectedValue(new Error('no gas')),
    balance: vi.fn().mockResolvedValue({ symbol: 'ETH', decimals: 18, formattedAmount: '10' }),
    address: vi.fn().mockResolvedValue('0xsender'),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  } as unknown as VaultBase
}

function makeSwapQuote() {
  return {
    fromCoin: { decimals: 18, ticker: 'ETH' },
    toCoin: { decimals: 8, ticker: 'BTC' },
    estimatedOutput: 100n,
    maxSwapable: 0n,
    provider: 'thorchain',
  }
}

function makeSwapVault(opts: { txHash: string; realSwaps: { count: number } }): VaultBase {
  const quote = makeSwapQuote()
  const swap = vi.fn(async (p: { dryRun?: boolean; fromChain?: Chain }) => {
    if (p.dryRun) return { dryRun: true, quote }
    opts.realSwaps.count += 1
    return { dryRun: false, txHash: opts.txHash, chain: Chain.Ethereum, quote }
  })
  return {
    type: 'fast',
    isEncrypted: false,
    isUnlocked: () => true,
    unlock: vi.fn(),
    id: 'vault-swap',
    name: 'vault-swap',
    publicKeys: { ecdsa: OWNER, eddsa: '' },
    swap,
    balance: vi.fn().mockResolvedValue({ symbol: 'ETH', decimals: 18 }),
    getDiscountTier: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  } as unknown as VaultBase
}

/** A swap vault whose dry-run `maxSwapable` DRIFTS between attempts — models the
 * fee/balance drift a `swap --max` retry sees. */
function makeDriftingMaxSwapVault(opts: {
  maxSwapables: bigint[]
  txHash: string
  realSwaps: { count: number }
}): VaultBase {
  let dry = 0
  const quoteFor = (maxSwapable: bigint) => ({
    fromCoin: { decimals: 18, ticker: 'ETH' },
    toCoin: { decimals: 8, ticker: 'BTC' },
    estimatedOutput: 100n,
    maxSwapable,
    provider: 'thorchain',
  })
  const swap = vi.fn(async (p: { dryRun?: boolean }) => {
    if (p.dryRun) {
      const maxSwapable = opts.maxSwapables[Math.min(dry, opts.maxSwapables.length - 1)]
      dry += 1
      return { dryRun: true, quote: quoteFor(maxSwapable) }
    }
    opts.realSwaps.count += 1
    return { dryRun: false, txHash: opts.txHash, chain: Chain.Ethereum, quote: quoteFor(0n) }
  })
  return {
    type: 'fast',
    isEncrypted: false,
    isUnlocked: () => true,
    unlock: vi.fn(),
    id: 'vault-swap-max',
    name: 'vault-swap-max',
    publicKeys: { ecdsa: OWNER, eddsa: '' },
    swap,
    balance: vi.fn().mockResolvedValue({ symbol: 'ETH', decimals: 18 }),
    getDiscountTier: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  } as unknown as VaultBase
}

/** A minimal vault for the agent executor cross-path check. */
function execVault(): VaultBase {
  return {
    name: 'vault-exec',
    id: 'vault-exec',
    type: 'secure',
    chains: [Chain.Ethereum],
    isEncrypted: false,
    address: vi.fn().mockResolvedValue('0xsender'),
    balance: vi.fn().mockResolvedValue({ decimals: 18, symbol: 'ETH' }),
    getTxStatus: vi.fn().mockResolvedValue({ status: 'success' }),
  } as unknown as VaultBase
}

// ---- Journal isolation -----------------------------------------------------

let home: string
let saved: string | undefined

function journalPathForTest(): string {
  return join(home, 'broadcasts.jsonl')
}

beforeEach(() => {
  saved = process.env.VULTISIG_BROADCAST_JOURNAL_PATH
  home = mkdtempSync(join(tmpdir(), 'vultisig-sendguard-'))
  process.env.VULTISIG_BROADCAST_JOURNAL_PATH = journalPathForTest()
})

afterEach(() => {
  if (saved === undefined) delete process.env.VULTISIG_BROADCAST_JOURNAL_PATH
  else process.env.VULTISIG_BROADCAST_JOURNAL_PATH = saved
  rmSync(home, { recursive: true, force: true })
  vi.clearAllMocks()
})

// ---- send ------------------------------------------------------------------

describe('send — broadcast dedupe guard', () => {
  const params = { chain: Chain.Ethereum, to: '0xrecipient', amount: '1', yes: true } as const

  it('includes an XRP DestinationTag in a dry-run result', async () => {
    const realSends = { count: 0 }
    const vault = makeSendVault({
      payload: nativeSendPayload('rRecipient', '1000000'),
      txHash: 'xrp-dry-run',
      realSends,
    })

    const result = await sendTransaction(vault, {
      chain: Chain.Ripple,
      to: 'rRecipient',
      amount: '1',
      destinationTag: 123,
      dryRun: true,
    })

    expect(result).toMatchObject({ dryRun: true, destinationTag: 123 })
    expect(realSends.count).toBe(0)
  })

  it('normalizes an XRP X-address and previews its embedded DestinationTag', async () => {
    const realSends = { count: 0 }
    const vault = makeSendVault({
      payload: nativeSendPayload('rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY', '1000000'),
      txHash: 'xrp-x-address-dry-run',
      realSends,
    })

    const result = await sendTransaction(vault, {
      chain: Chain.Ripple,
      to: 'XV5sbjUmgPpvXv4ixFWZ5ptAYZ6PD2q1qM6owqNbug8W6KV',
      amount: '1',
      dryRun: true,
    })

    expect(result).toMatchObject({
      dryRun: true,
      to: 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY',
      destinationTag: 495,
    })
    expect(vault.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'XV5sbjUmgPpvXv4ixFWZ5ptAYZ6PD2q1qM6owqNbug8W6KV',
        destinationTag: 495,
      })
    )
    expect(realSends.count).toBe(0)
  })

  it('rejects an explicit DestinationTag that conflicts with an X-address', async () => {
    const vault = makeSendVault({
      payload: nativeSendPayload('rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY', '1000000'),
      txHash: 'xrp-conflicting-tag',
      realSends: { count: 0 },
    })

    await expect(
      sendTransaction(vault, {
        chain: Chain.Ripple,
        to: 'XV5sbjUmgPpvXv4ixFWZ5ptAYZ6PD2q1qM6owqNbug8W6KV',
        amount: '1',
        destinationTag: 123,
        dryRun: true,
      })
    ).rejects.toThrow(/Conflicting XRP destination tags/)
  })

  it('refuses an identical second send within the window (no second broadcast, exit 9)', async () => {
    const realSends = { count: 0 }
    const vault = makeSendVault({
      payload: nativeSendPayload('0xrecipient', '1000000000000000000'),
      txHash: '0xfirst',
      realSends,
    })

    // First send broadcasts and journals.
    const first = await sendTransaction(vault, { ...params })
    expect((first as { txHash: string }).txHash).toBe('0xfirst')
    expect(realSends.count).toBe(1)

    // Second identical send is refused BEFORE signing — nothing broadcast.
    await expect(sendTransaction(vault, { ...params })).rejects.toMatchObject({
      code: AgentErrorCode.DUPLICATE_BROADCAST,
    })
    expect(realSends.count).toBe(1) // still 1 — the duplicate never broadcast

    // And the refusal maps to the dedicated exit code 9.
    const err = await sendTransaction(vault, { ...params }).catch(e => e)
    expect(classifyError(err).exitCode).toBe(ExitCode.DUPLICATE_BROADCAST)
  })

  it('--force overrides the guard', async () => {
    const realSends = { count: 0 }
    const vault = makeSendVault({
      payload: nativeSendPayload('0xrecipient', '1000000000000000000'),
      txHash: '0xforced',
      realSends,
    })

    await sendTransaction(vault, { ...params })
    await sendTransaction(vault, { ...params, force: true })
    expect(realSends.count).toBe(2) // forced through
  })

  it('persists across separate CLI processes and exits 9 unless --force is used', () => {
    const fixture = new URL('./fixtures/sendProcess.ts', import.meta.url)
    const run = (amount = '1', force = false) =>
      spawnSync(
        'yarn',
        ['workspace', '@vultisig/cli', 'exec', 'tsx', fixture.pathname, journalPathForTest(), amount, String(force)],
        { cwd: new URL('../../../../..', import.meta.url), encoding: 'utf8' }
      )

    const first = run()
    expect(first.status, first.stderr).toBe(0)

    const duplicate = run()
    expect(duplicate.status).toBe(ExitCode.DUPLICATE_BROADCAST)
    expect(duplicate.stderr).toMatch(/Refusing to broadcast: an identical transaction/)

    const distinct = run('2')
    expect(distinct.status, distinct.stderr).toBe(0)

    const forced = run('1', true)
    expect(forced.status, forced.stderr).toBe(0)
  }, 30_000)

  it('does not block a genuinely distinct intent', async () => {
    const realSends = { count: 0 }
    const vault = makeSendVault({
      payload: nativeSendPayload('0xrecipient', '1000000000000000000'),
      txHash: '0xa',
      realSends,
    })
    await sendTransaction(vault, { ...params })

    // Different recipient → different resolved payload → allowed. Repoint the
    // dry-run payload to the new recipient the second call would resolve.
    ;(vault.send as unknown as { mockImplementation: (f: unknown) => void }).mockImplementation(
      async (p: { dryRun?: boolean; chain: Chain }) => {
        if (p.dryRun)
          return {
            dryRun: true,
            fee: '0.001',
            total: '1.001',
            keysignPayload: nativeSendPayload('0xother', '1000000000000000000'),
          }
        realSends.count += 1
        return { dryRun: false, txHash: '0xb', chain: p.chain }
      }
    )
    await sendTransaction(vault, { chain: Chain.Ethereum, to: '0xother', amount: '1', yes: true })
    expect(realSends.count).toBe(2)
  })

  it('cross-PATH: a send then an identical agent-ask intent dedupe against the shared journal', async () => {
    const realSends = { count: 0 }
    const vault = makeSendVault({
      ecdsa: OWNER,
      payload: nativeSendPayload('0xrecipient', '1000000000000000000'),
      txHash: '0xsend',
      realSends,
    })
    // 1. Direct `send` records a broadcast in the journal.
    await sendTransaction(vault, { ...params })

    // 2. The agent path (same owner, identical intent) must refuse before signing.
    const executor = new AgentExecutor(execVault(), false, OWNER)
    const signSpy = vi
      .spyOn(executor as unknown as { signServerTx: (...a: unknown[]) => Promise<unknown> }, 'signServerTx')
      .mockResolvedValue({ tx_hash: '0xshouldnothappen', chain: 'Ethereum', status: 'pending' })

    executor.storeServerTransaction({
      chain: 'Ethereum',
      from_chain: 'Ethereum',
      send_tx: { to: '0xrecipient', value: '1000000000000000000' },
    })
    const agentResult = await executor.signTxFromBuffer('call-cross')
    expect(agentResult.success).toBe(false)
    expect(agentResult.data?.code).toBe(AgentErrorCode.DUPLICATE_BROADCAST)
    expect(signSpy).not.toHaveBeenCalled() // never double-signed across paths
  })

  it('cross-PATH: both real builders fingerprint empty EVM calldata identically', () => {
    const vault = makeSendVault({
      ecdsa: OWNER,
      payload: nativeSendPayload('0xrecipient', '17000000000000000'),
      txHash: '0xunused',
      realSends: { count: 0 },
    })
    const directIntent = buildSendBroadcastIntent(
      vault,
      Chain.Polygon,
      nativeSendPayload('0xrecipient', '17000000000000000')
    )
    const executor = new AgentExecutor(execVault(), false, OWNER)
    const agentIntent = (
      executor as unknown as {
        buildBroadcastIntent: (payload: unknown, chain: Chain) => Parameters<typeof computeFingerprint>[0]
      }
    ).buildBroadcastIntent(
      {
        send_tx: { to: '0xrecipient', value: '17000000000000000', data: '0x' },
      },
      Chain.Polygon
    )

    expect(directIntent.data).toBeUndefined()
    expect(agentIntent.data).toBe('0x')
    expect(computeFingerprint(directIntent)).toBe(computeFingerprint(agentIntent))
  })

  it('cross-PATH: an EVM `--memo 0x` send folds to empty calldata and still dedupes across paths', () => {
    // On EVM the signer encodes a `0x`-prefixed memo AS calldata (memoToTxData),
    // so `--memo 0x` is empty calldata — identical to a no-memo native transfer.
    // buildSendBroadcastIntent must therefore mark it EVM calldata so it folds to
    // "" and matches (a) the same send with no memo and (b) the agent path's empty
    // `"0x"` calldata. Without the chain-kind gate this regressed (PR #1259 review).
    const vault = makeSendVault({
      ecdsa: OWNER,
      payload: nativeSendPayload('0xrecipient', '17000000000000000'),
      txHash: '0xunused',
      realSends: { count: 0 },
    })
    const withZeroXMemo = buildSendBroadcastIntent(vault, Chain.Ethereum, {
      ...nativeSendPayload('0xrecipient', '17000000000000000'),
      memo: '0x',
    } as unknown as KeysignPayload)
    const noMemo = buildSendBroadcastIntent(
      vault,
      Chain.Ethereum,
      nativeSendPayload('0xrecipient', '17000000000000000')
    )
    const executor = new AgentExecutor(execVault(), false, OWNER)
    const agentIntent = (
      executor as unknown as {
        buildBroadcastIntent: (payload: unknown, chain: Chain) => Parameters<typeof computeFingerprint>[0]
      }
    ).buildBroadcastIntent({ send_tx: { to: '0xrecipient', value: '17000000000000000', data: '0x' } }, Chain.Ethereum)

    expect(withZeroXMemo.dataIsEvmCalldata).toBe(true)
    // All three describe the same empty-calldata EVM native send → one fingerprint.
    expect(computeFingerprint(withZeroXMemo)).toBe(computeFingerprint(noMemo))
    expect(computeFingerprint(withZeroXMemo)).toBe(computeFingerprint(agentIntent))
  })

  it('non-EVM `--memo 0x` stays distinct from no memo (memo is a real value, not calldata)', () => {
    // The mirror of the EVM case: on a memo-routed chain `"0x"` is a genuine memo
    // and must NOT fold to empty, or two different sends would falsely dedupe.
    const vault = makeSendVault({
      ecdsa: OWNER,
      payload: memoSendPayload('thor1recipient', '100000000', '0x'),
      txHash: '0xunused',
      realSends: { count: 0 },
    })
    const withZeroXMemo = buildSendBroadcastIntent(
      vault,
      Chain.THORChain,
      memoSendPayload('thor1recipient', '100000000', '0x')
    )
    const noMemo = buildSendBroadcastIntent(vault, Chain.THORChain, memoSendPayload('thor1recipient', '100000000', ''))
    expect(withZeroXMemo.dataIsEvmCalldata).toBe(false)
    expect(computeFingerprint(withZeroXMemo)).not.toBe(computeFingerprint(noMemo))
  })

  it('token (ERC-20) sends: identical refused, a different token to the same recipient allowed', async () => {
    const realSends = { count: 0 }
    const vault = makeSendVault({
      payload: tokenSendPayload('0xrecipient', '1000000', '0xTokenA'),
      txHash: '0xtokenA',
      realSends,
    })
    // First USDC(TokenA) send journals.
    await sendTransaction(vault, { ...params })
    // Identical TokenA send is refused (asset discriminator matches).
    await expect(sendTransaction(vault, { ...params })).rejects.toMatchObject({
      code: AgentErrorCode.DUPLICATE_BROADCAST,
    })
    expect(realSends.count).toBe(1)

    // A DIFFERENT token (same to/amount) has a distinct `asset` → distinct
    // fingerprint → allowed. This is the fund-safety discriminator that stops two
    // different tokens from being conflated.
    ;(vault.send as unknown as { mockImplementation: (f: unknown) => void }).mockImplementation(
      async (p: { dryRun?: boolean; chain: Chain }) => {
        if (p.dryRun)
          return {
            dryRun: true,
            fee: '0.001',
            total: '1',
            keysignPayload: tokenSendPayload('0xrecipient', '1000000', '0xTokenB'),
          }
        realSends.count += 1
        return { dryRun: false, txHash: '0xtokenB', chain: p.chain }
      }
    )
    await sendTransaction(vault, { ...params })
    expect(realSends.count).toBe(2)
  })

  it('a broadcast that THROWS is not journaled, so a genuine retry is allowed', async () => {
    const realSends = { count: 0 }
    let fail = true
    const send = vi.fn(async (p: { dryRun?: boolean; chain: Chain }) => {
      if (p.dryRun)
        return {
          dryRun: true,
          fee: '0.001',
          total: '1',
          keysignPayload: nativeSendPayload('0xrecipient', '1000000000000000000'),
        }
      if (fail) throw new Error('broadcast RPC failed')
      realSends.count += 1
      return { dryRun: false, txHash: '0xafterfail', chain: p.chain }
    })
    const vault = {
      type: 'fast',
      isEncrypted: false,
      isUnlocked: () => true,
      unlock: vi.fn(),
      id: 'v',
      name: 'v',
      publicKeys: { ecdsa: OWNER, eddsa: '' },
      send,
      gas: vi.fn().mockRejectedValue(new Error('no gas')),
      balance: vi.fn().mockResolvedValue({ symbol: 'ETH', decimals: 18, formattedAmount: '10' }),
      address: vi.fn().mockResolvedValue('0xsender'),
      on: vi.fn(),
      removeAllListeners: vi.fn(),
    } as unknown as VaultBase

    // First attempt broadcasts→throws: nothing journaled, reservation released.
    await expect(sendTransaction(vault, { ...params })).rejects.toThrow('broadcast RPC failed')
    // Retry must NOT be blocked by the failed attempt — the guard only records a
    // real hash, so a genuine retry after a failure proceeds.
    fail = false
    const ok = await sendTransaction(vault, { ...params })
    expect((ok as { txHash: string }).txHash).toBe('0xafterfail')
    expect(realSends.count).toBe(1)
  })

  it('a sibling-held reservation (ConcurrentBroadcastError) refuses without signing, exit 9', async () => {
    const realSends = { count: 0 }
    const vault = makeSendVault({
      payload: nativeSendPayload('0xrecipient', '1000000000000000000'),
      txHash: '0xshouldnothappen',
      realSends,
    })
    // A sibling process holds the atomic reservation for this exact intent.
    const held = reserveBroadcast(
      computeFingerprint(
        buildSendBroadcastIntent(vault, Chain.Ethereum, nativeSendPayload('0xrecipient', '1000000000000000000'))
      )
    )

    const err = await sendTransaction(vault, { ...params }).catch(e => e)
    expect(err.code).toBe(AgentErrorCode.DUPLICATE_BROADCAST)
    expect(classifyError(err).exitCode).toBe(ExitCode.DUPLICATE_BROADCAST)
    expect(realSends.count).toBe(0) // never signed while the sibling holds it

    // Once the sibling releases, a send proceeds normally.
    held.release()
    await sendTransaction(vault, { ...params })
    expect(realSends.count).toBe(1)
  })

  it('--max retries dedupe even when the resolved amount drifts (stable max fingerprint)', async () => {
    const realSends = { count: 0 }
    // First dry-run resolves 9.98 ETH; the retry's dry-run resolves 9.97 (fee
    // drift). Without the stable `max` sentinel these fingerprint differently and
    // the retry would double-spend.
    const { vault } = makeDriftingMaxVault({
      payloads: [
        nativeSendPayload('0xrecipient', '9980000000000000000'),
        nativeSendPayload('0xrecipient', '9970000000000000000'),
      ],
      txHash: '0xmax',
      realSends,
    })
    await sendTransaction(vault, { chain: Chain.Ethereum, to: '0xrecipient', amount: 'max', yes: true })
    await expect(
      sendTransaction(vault, { chain: Chain.Ethereum, to: '0xrecipient', amount: 'max', yes: true })
    ).rejects.toMatchObject({ code: AgentErrorCode.DUPLICATE_BROADCAST })
    expect(realSends.count).toBe(1) // drift did NOT let the max retry through
  })

  it('memo distinguishes otherwise-identical sends (data discriminator, no false lockout on memo chains)', async () => {
    const realSends = { count: 0 }
    const thorParams = { chain: Chain.THORChain, to: 'thor1recipient', amount: '1', yes: true } as const
    const vault = makeSendVault({
      payload: memoSendPayload('thor1recipient', '100000000', 'depositA'),
      txHash: '0xmemoA',
      realSends,
    })

    // Identical send + same memo → refused.
    await sendTransaction(vault, { ...thorParams, memo: 'depositA' })
    await expect(sendTransaction(vault, { ...thorParams, memo: 'depositA' })).rejects.toMatchObject({
      code: AgentErrorCode.DUPLICATE_BROADCAST,
    })
    expect(realSends.count).toBe(1)

    // Same to/amount but a DIFFERENT memo is a genuinely different tx (memo-routed
    // chains) → distinct `data` → distinct fingerprint → allowed (no false lockout).
    ;(vault.send as unknown as { mockImplementation: (f: unknown) => void }).mockImplementation(
      async (p: { dryRun?: boolean; chain: Chain }) => {
        if (p.dryRun)
          return {
            dryRun: true,
            fee: '0.001',
            total: '1',
            keysignPayload: memoSendPayload('thor1recipient', '100000000', 'depositB'),
          }
        realSends.count += 1
        return { dryRun: false, txHash: '0xmemoB', chain: p.chain }
      }
    )
    await sendTransaction(vault, { ...thorParams, memo: 'depositB' })
    expect(realSends.count).toBe(2)
  })

  it('fails closed when the vault has no owner namespace (no ecdsa, no id)', () => {
    // A malformed/uninitialized vault must NOT be namespaced under an empty owner
    // (which would collapse distinct vaults into one fingerprint). Refuse instead.
    const ownerless = { publicKeys: { ecdsa: '', eddsa: '' }, id: '' } as unknown as VaultBase
    expect(() => buildSendBroadcastIntent(ownerless, Chain.Ethereum, nativeSendPayload('0xrecipient', '1'))).toThrow(
      /no ECDSA public key or id/i
    )
  })
})

// ---- swap ------------------------------------------------------------------

describe('swap — broadcast dedupe guard', () => {
  const ctxFor = (vault: VaultBase) => ({ ensureActiveVault: async () => vault }) as never
  const opts = { fromChain: Chain.Ethereum, toChain: Chain.Bitcoin, amount: 0.1, yes: true } as const

  it('forwards CLI slippage into vault.swap preview and execution requests', async () => {
    const realSwaps = { count: 0 }
    const vault = makeSwapVault({ txHash: '0xslippage', realSwaps })

    const result = await executeSwap(ctxFor(vault), { ...opts, slippage: 2.5, dryRun: true })

    expect(result).toMatchObject({ dryRun: true, provider: 'thorchain' })
    expect(vault.swap).toHaveBeenCalledTimes(1)
    expect(vault.swap).toHaveBeenCalledWith(
      expect.objectContaining({
        fromChain: Chain.Ethereum,
        toChain: Chain.Bitcoin,
        amount: '0.1',
        slippageTolerance: 2.5,
        dryRun: true,
      })
    )
    expect(realSwaps.count).toBe(0)
  })

  it('refuses an identical second swap (no second broadcast)', async () => {
    const realSwaps = { count: 0 }
    const vault = makeSwapVault({ txHash: '0xswap1', realSwaps })

    const first = await executeSwap(ctxFor(vault), { ...opts })
    expect((first as { txHash: string }).txHash).toBe('0xswap1')
    expect(realSwaps.count).toBe(1)

    const err = await executeSwap(ctxFor(vault), { ...opts }).catch(e => e)
    expect(err.code).toBe(AgentErrorCode.DUPLICATE_BROADCAST)
    expect(classifyError(err).exitCode).toBe(ExitCode.DUPLICATE_BROADCAST) // exit 9 parity with send
    expect(realSwaps.count).toBe(1)
  })

  it('--force overrides and distinct swaps are allowed', async () => {
    const realSwaps = { count: 0 }
    const vault = makeSwapVault({ txHash: '0xswap', realSwaps })

    await executeSwap(ctxFor(vault), { ...opts })
    await executeSwap(ctxFor(vault), { ...opts, force: true }) // forced
    expect(realSwaps.count).toBe(2)

    // A distinct amount is a distinct intent → allowed without --force.
    await executeSwap(ctxFor(vault), { ...opts, amount: 0.2 })
    expect(realSwaps.count).toBe(3)
  })

  it('--max retries dedupe even when maxSwapable drifts (stable max fingerprint)', async () => {
    const realSwaps = { count: 0 }
    // The retry's dry-run resolves a slightly smaller max (fee/balance drift).
    // Without the stable `max` sentinel these fingerprint differently and the
    // retry double-broadcasts.
    const vault = makeDriftingMaxSwapVault({ maxSwapables: [998n, 997n], txHash: '0xswapmax', realSwaps })

    await executeSwap(ctxFor(vault), { ...opts, amount: 'max' })
    await expect(executeSwap(ctxFor(vault), { ...opts, amount: 'max' })).rejects.toMatchObject({
      code: AgentErrorCode.DUPLICATE_BROADCAST,
    })
    expect(realSwaps.count).toBe(1) // drift did NOT let the max swap retry through
  })
})
