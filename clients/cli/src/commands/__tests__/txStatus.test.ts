import { Chain } from '@vultisig/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ExitCode, InvalidTxHashError, toErrorJson, TxNotFoundError, TxStatusTimeoutError } from '../../core/errors'
import { configureOutput, resetOutput, setSilentMode } from '../../lib/output'
import { executeTxStatus, resolveTimeoutMs, resolveTxStatusParams } from '../tx-status'

const EVM_HASH = '0x' + 'a'.repeat(64)

function makeCtx(getTxStatus: ReturnType<typeof vi.fn>) {
  return {
    ensureActiveVault: vi.fn().mockResolvedValue({ getTxStatus }),
  } as any
}

describe('resolveTxStatusParams', () => {
  it('rejects a malformed hash before command-layer vault lookup', () => {
    expect(() => resolveTxStatusParams({ chain: Chain.Ethereum, txHash: 'nothash' })).toThrow(InvalidTxHashError)
  })
})

describe('executeTxStatus', () => {
  beforeEach(() => {
    // Suppress the ora spinner (stderr) so tests stay quiet and synchronous.
    setSilentMode(true)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    resetOutput()
    setSilentMode(false)
  })

  it('rejects a malformed hash as invalid_hash before vault access or RPC', async () => {
    const getTxStatus = vi.fn()
    const ensureActiveVault = vi.fn().mockResolvedValue({ getTxStatus })
    const ctx = { ensureActiveVault } as any

    const error = await executeTxStatus(ctx, { chain: Chain.Ethereum, txHash: 'nothash' }).catch(error => error)

    expect(error).toBeInstanceOf(InvalidTxHashError)
    expect(error).toMatchObject({
      code: 'INVALID_HASH',
      exitCode: ExitCode.INVALID_INPUT,
      context: { chain: Chain.Ethereum, txHash: 'nothash', status: 'invalid_hash' },
    })
    expect(toErrorJson(error).error).toMatchObject({
      code: 'INVALID_HASH',
      exitCode: ExitCode.INVALID_INPUT,
      context: { status: 'invalid_hash' },
    })
    expect(ensureActiveVault).not.toHaveBeenCalled()
    expect(getTxStatus).not.toHaveBeenCalled()
  })

  it.each([
    [{ status: 'pending' as const, isKnown: true }, 'pending'],
    [{ status: 'not_found' as const, isKnown: false }, 'not_found'],
    [{ status: 'success' as const, receipt: undefined }, 'confirmed'],
    [{ status: 'error' as const, receipt: undefined }, 'failed'],
  ])('emits the CLI status %s consistently in JSON mode', async (result, expectedStatus) => {
    configureOutput({ format: 'json' })
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await executeTxStatus(makeCtx(vi.fn().mockResolvedValue(result)), {
      chain: Chain.Ethereum,
      txHash: EVM_HASH,
      noWait: true,
    })

    const envelope = JSON.parse(String(write.mock.calls.at(-1)?.[0]))
    expect(envelope.data.status).toBe(expectedStatus)
  })

  it.each([
    [{ status: 'pending' as const, isKnown: true }, 'pending'],
    [{ status: 'not_found' as const, isKnown: false }, 'not_found'],
    [{ status: 'success' as const, receipt: undefined }, 'confirmed'],
    [{ status: 'error' as const, receipt: undefined }, 'failed'],
  ])('emits the CLI status %s consistently in human mode', async (result, expectedStatus) => {
    configureOutput({ format: 'table' })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await executeTxStatus(makeCtx(vi.fn().mockResolvedValue(result)), {
      chain: Chain.Ethereum,
      txHash: EVM_HASH,
      noWait: true,
    })

    expect(log.mock.calls.flat().join('\n')).toContain(`Status: ${expectedStatus}`)
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

describe('resolveTimeoutMs', () => {
  const DEFAULT_MS = 120_000

  it('falls back to the default budget for undefined or non-finite input', () => {
    expect(resolveTimeoutMs(undefined)).toBe(DEFAULT_MS)
    expect(resolveTimeoutMs(Number.NaN)).toBe(DEFAULT_MS)
    expect(resolveTimeoutMs(Number.POSITIVE_INFINITY)).toBe(DEFAULT_MS)
  })

  it('clamps a negative timeout to an immediate (0ms) give-up', () => {
    expect(resolveTimeoutMs(-5)).toBe(0)
  })

  it('scales a normal timeout to milliseconds', () => {
    expect(resolveTimeoutMs(30)).toBe(30_000)
  })

  it('stays finite when a huge (but finite) timeout overflows after ×1000', () => {
    // 1e308 is finite and passes the CLI `--timeout` guard, but 1e308 * 1000
    // overflows to Infinity. An Infinite deadline makes the poll give-up check
    // (`remainingMs <= 0`) unreachable — the infinite poll the guard forbids.
    const ms = resolveTimeoutMs(1e308)
    expect(Number.isFinite(ms)).toBe(true)
    expect(ms).toBe(Number.MAX_SAFE_INTEGER)
  })
})
