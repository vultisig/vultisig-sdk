import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Chain } from '@vultisig/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InvalidInputError, TxNotFoundError, TxStatusTimeoutError } from '../../core/errors'
import { setSilentMode } from '../../lib/output'
import { executeTxStatus } from '../tx-status'

const EVM_HASH = '0x' + 'a'.repeat(64)

function makeCtx(getTxStatus: ReturnType<typeof vi.fn>) {
  return {
    ensureActiveVault: vi.fn().mockResolvedValue({ getTxStatus }),
  } as any
}

describe('executeTxStatus', () => {
  let journalDir: string
  let savedJournalPath: string | undefined

  beforeEach(() => {
    // Suppress the ora spinner (stderr) so tests stay quiet and synchronous.
    setSilentMode(true)
    savedJournalPath = process.env.VULTISIG_BROADCAST_JOURNAL_PATH
    journalDir = mkdtempSync(join(tmpdir(), 'vultisig-tx-status-journal-'))
    process.env.VULTISIG_BROADCAST_JOURNAL_PATH = join(journalDir, 'broadcasts.jsonl')
  })
  afterEach(() => {
    if (savedJournalPath === undefined) delete process.env.VULTISIG_BROADCAST_JOURNAL_PATH
    else process.env.VULTISIG_BROADCAST_JOURNAL_PATH = savedJournalPath
    rmSync(journalDir, { recursive: true, force: true })
    setSilentMode(false)
    vi.clearAllMocks()
  })

  it('rejects a malformed hash with INVALID_INPUT and never calls the RPC', async () => {
    const getTxStatus = vi.fn()
    const ctx = makeCtx(getTxStatus)

    await expect(executeTxStatus(ctx, { chain: Chain.Ethereum, txHash: 'nothash' })).rejects.toBeInstanceOf(
      InvalidInputError
    )
    expect(getTxStatus).not.toHaveBeenCalled()
  })

  it('returns success + receipt for a confirmed hash', async () => {
    const result = {
      status: 'success' as const,
      receipt: { feeAmount: 42_000_000_000_000n, feeDecimals: 18, feeTicker: 'ETH' },
    }
    const getTxStatus = vi.fn().mockResolvedValue(result)
    const ctx = makeCtx(getTxStatus)

    const out = await executeTxStatus(ctx, { chain: Chain.Ethereum, txHash: EVM_HASH })
    expect(out).toEqual(result)
    expect(getTxStatus).toHaveBeenCalledTimes(1)
    expect(readFileSync(process.env.VULTISIG_BROADCAST_JOURNAL_PATH!, 'utf8')).toContain(
      `"t":"resolved","hash":"${EVM_HASH}","status":"confirmed"`
    )
  })

  it('records a definitive on-chain error as a failed broadcast resolution', async () => {
    const result = { status: 'error' as const, receipt: undefined }
    const getTxStatus = vi.fn().mockResolvedValue(result)

    await expect(executeTxStatus(makeCtx(getTxStatus), { chain: Chain.Ethereum, txHash: EVM_HASH })).resolves.toEqual(
      result
    )
    expect(readFileSync(process.env.VULTISIG_BROADCAST_JOURNAL_PATH!, 'utf8')).toContain(
      `"t":"resolved","hash":"${EVM_HASH}","status":"failed"`
    )
  })

  it('throws TxNotFoundError (never polls forever) for a well-formed hash the node has never seen', async () => {
    const getTxStatus = vi.fn().mockResolvedValue({ status: 'not_found', isKnown: false })
    const ctx = makeCtx(getTxStatus)

    await expect(
      // timeoutSec:0 → give up immediately after the first check, no sleeping.
      executeTxStatus(ctx, { chain: Chain.Ethereum, txHash: EVM_HASH, timeoutSec: 0 })
    ).rejects.toBeInstanceOf(TxNotFoundError)
    expect(getTxStatus).toHaveBeenCalledTimes(1)
  })

  it('throws TxStatusTimeoutError when the tx stays pending past the wait budget', async () => {
    const getTxStatus = vi.fn().mockResolvedValue({ status: 'pending', isKnown: true })
    const ctx = makeCtx(getTxStatus)

    await expect(
      executeTxStatus(ctx, { chain: Chain.Ethereum, txHash: EVM_HASH, timeoutSec: 0 })
    ).rejects.toBeInstanceOf(TxStatusTimeoutError)
    expect(getTxStatus).toHaveBeenCalledTimes(1)
  })

  it('does not loop forever on a negative timeout — clamps to an immediate give-up', async () => {
    const getTxStatus = vi.fn().mockResolvedValue({ status: 'not_found', isKnown: false })
    const ctx = makeCtx(getTxStatus)

    await expect(
      executeTxStatus(ctx, { chain: Chain.Ethereum, txHash: EVM_HASH, timeoutSec: -5 })
    ).rejects.toBeInstanceOf(TxNotFoundError)
    expect(getTxStatus).toHaveBeenCalledTimes(1)
  })

  it('does not loop forever on a non-finite (NaN) timeout — falls back to a finite budget', async () => {
    // If NaN reached the deadline math unguarded, `Date.now() >= Date.now()+NaN`
    // is always false and the poll would never terminate. The guard maps NaN to
    // the default budget, so with pollIntervalMs:0 the loop still spins but the
    // deadline is a real finite timestamp; here the tx confirms on the 2nd poll.
    const getTxStatus = vi
      .fn()
      .mockResolvedValueOnce({ status: 'pending', isKnown: true })
      .mockResolvedValueOnce({ status: 'success', receipt: undefined })
    const ctx = makeCtx(getTxStatus)

    const out = await executeTxStatus(
      ctx,
      { chain: Chain.Ethereum, txHash: EVM_HASH, timeoutSec: Number.NaN },
      { pollIntervalMs: 0 }
    )
    expect(out.status).toBe('success')
    expect(getTxStatus).toHaveBeenCalledTimes(2)
  })

  it('reports not_found without throwing in --no-wait mode', async () => {
    const getTxStatus = vi.fn().mockResolvedValue({ status: 'not_found', isKnown: false })
    const ctx = makeCtx(getTxStatus)

    const out = await executeTxStatus(ctx, { chain: Chain.Ethereum, txHash: EVM_HASH, noWait: true })
    expect(out.status).toBe('not_found')
    expect(getTxStatus).toHaveBeenCalledTimes(1)
  })

  it('caps the poll sleep at the remaining budget instead of oversleeping a full interval', async () => {
    // timeoutSec:2 with the 5s default poll interval — the sleep before the 2nd
    // poll must be capped to the ~2s remaining, not the full 5s interval.
    const getTxStatus = vi.fn().mockResolvedValue({ status: 'pending', isKnown: true })
    const ctx = makeCtx(getTxStatus)

    vi.useFakeTimers()
    try {
      const promise = executeTxStatus(ctx, { chain: Chain.Ethereum, txHash: EVM_HASH, timeoutSec: 2 })
      promise.catch(() => {}) // avoid unhandled rejection warning while advancing timers

      // Advancing by just the remaining budget (2s) — not the full 5s poll
      // interval — must be enough to trigger the 2nd poll and the give-up.
      await vi.advanceTimersByTimeAsync(2_000)

      await expect(promise).rejects.toBeInstanceOf(TxStatusTimeoutError)
      expect(getTxStatus).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('polls until a terminal status and then resolves', async () => {
    const getTxStatus = vi
      .fn()
      .mockResolvedValueOnce({ status: 'pending', isKnown: true })
      .mockResolvedValueOnce({ status: 'pending', isKnown: true })
      .mockResolvedValueOnce({ status: 'success', receipt: undefined })
    const ctx = makeCtx(getTxStatus)

    const out = await executeTxStatus(
      ctx,
      { chain: Chain.Ethereum, txHash: EVM_HASH, timeoutSec: 60 },
      { pollIntervalMs: 0 } // no real waiting between polls
    )
    expect(out.status).toBe('success')
    expect(getTxStatus).toHaveBeenCalledTimes(3)
  })
})
