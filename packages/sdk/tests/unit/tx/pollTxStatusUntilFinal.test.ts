import { Chain } from '@vultisig/core-chain/Chain'
import type { TxStatusResult } from '@vultisig/core-chain/tx/status/resolver'
import { describe, expect, it, vi } from 'vitest'

import { pollTxStatusUntilFinal } from '@/tx'
import { VaultError, VaultErrorCode } from '@/vault/VaultError'

describe('pollTxStatusUntilFinal', () => {
  it('returns on the first terminal status', async () => {
    const getTxStatus = vi.fn().mockResolvedValue({ status: 'success' } satisfies TxStatusResult)

    const outcome = await pollTxStatusUntilFinal({
      chain: Chain.Ethereum,
      txHash: '0xabc',
      getTxStatus,
    })

    expect(outcome).toMatchObject({ timedOut: false, attempts: 1, result: { status: 'success' } })
    expect(getTxStatus).toHaveBeenCalledTimes(1)
  })

  it('polls until a later attempt becomes terminal', async () => {
    let now = 0
    const getTxStatus = vi
      .fn()
      .mockResolvedValueOnce({ status: 'pending', isKnown: true } satisfies TxStatusResult)
      .mockResolvedValueOnce({ status: 'pending', isKnown: true } satisfies TxStatusResult)
      .mockResolvedValueOnce({ status: 'success' } satisfies TxStatusResult)

    const outcome = await pollTxStatusUntilFinal({
      chain: Chain.Ethereum,
      txHash: '0xabc',
      intervalMs: 25,
      timeoutMs: 100,
      now: () => now,
      sleep: async (ms: number) => {
        now += ms
      },
      getTxStatus,
    })

    expect(outcome).toMatchObject({ timedOut: false, attempts: 3, result: { status: 'success' } })
    expect(outcome.elapsedMs).toBe(50)
    expect(getTxStatus).toHaveBeenCalledTimes(3)
  })

  it('retries only configured transient errors', async () => {
    let now = 0
    const getTxStatus = vi
      .fn()
      .mockRejectedValueOnce(new VaultError(VaultErrorCode.NetworkError, 'rpc timeout'))
      .mockResolvedValueOnce({ status: 'success' } satisfies TxStatusResult)

    const outcome = await pollTxStatusUntilFinal({
      chain: Chain.Ethereum,
      txHash: '0xabc',
      intervalMs: 10,
      timeoutMs: 50,
      now: () => now,
      sleep: async (ms: number) => {
        now += ms
      },
      getTxStatus,
      shouldRetryError: (error: unknown) =>
        error instanceof VaultError && (error as VaultError).code === VaultErrorCode.NetworkError,
    })

    expect(outcome).toMatchObject({ timedOut: false, attempts: 2, result: { status: 'success' } })
  })

  it('reuses an initial non-terminal result instead of immediately re-polling', async () => {
    let now = 0
    const sleepCalls: number[] = []
    const getTxStatus = vi.fn().mockResolvedValue({ status: 'success' } satisfies TxStatusResult)

    const outcome = await pollTxStatusUntilFinal({
      chain: Chain.Ethereum,
      txHash: '0xabc',
      initialResult: { status: 'pending', isKnown: true },
      intervalMs: 25,
      timeoutMs: 100,
      now: () => now,
      sleep: async (ms: number) => {
        sleepCalls.push(ms)
        now += ms
      },
      getTxStatus,
    })

    expect(outcome).toMatchObject({ timedOut: false, attempts: 1, result: { status: 'success' } })
    expect(sleepCalls).toEqual([25])
    expect(getTxStatus).toHaveBeenCalledTimes(1)
  })

  it('returns the last observed status when the budget expires', async () => {
    let now = 0
    const getTxStatus = vi.fn().mockResolvedValue({ status: 'pending', isKnown: true } satisfies TxStatusResult)

    const outcome = await pollTxStatusUntilFinal({
      chain: Chain.Ethereum,
      txHash: '0xabc',
      intervalMs: 25,
      timeoutMs: 60,
      now: () => now,
      sleep: async (ms: number) => {
        now += ms
      },
      getTxStatus,
    })

    expect(outcome.timedOut).toBe(true)
    expect(outcome.result).toMatchObject({ status: 'pending' })
    expect(getTxStatus).toHaveBeenCalledTimes(4)
  })
})