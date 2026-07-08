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
  beforeEach(() => {
    // Suppress the ora spinner (stderr) so tests stay quiet and synchronous.
    setSilentMode(true)
  })
  afterEach(() => {
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

  it('reports not_found without throwing in --no-wait mode', async () => {
    const getTxStatus = vi.fn().mockResolvedValue({ status: 'not_found', isKnown: false })
    const ctx = makeCtx(getTxStatus)

    const out = await executeTxStatus(ctx, { chain: Chain.Ethereum, txHash: EVM_HASH, noWait: true })
    expect(out.status).toBe('not_found')
    expect(getTxStatus).toHaveBeenCalledTimes(1)
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
