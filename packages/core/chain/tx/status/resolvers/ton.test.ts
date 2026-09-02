import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  queryUrl: vi.fn(),
}))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: mocks.queryUrl,
}))

import { Chain, OtherChain } from '../../../Chain'
import { chainFeeCoin } from '../../../coin/chainFeeCoin'
import { getTonTxStatus } from './ton'

const hash = 'ly7MV9j/7YxLIJECJyURsKthTLOJKtoYP6sMJLi/H8E='

const feeCoin = chainFeeCoin[Chain.Ton]

const receipt = { feeAmount: 1_000_000n, feeDecimals: feeCoin.decimals, feeTicker: feeCoin.ticker }

const okComputePhase = { skipped: false, success: true, mode: 0, exit_code: 0, vm_steps: 66 }

const okActionPhase = {
  success: true,
  valid: true,
  no_funds: false,
  status_change: 'unchanged',
  result_code: 0,
  tot_actions: 1,
  skipped_actions: 0,
  msgs_created: 1,
}

const respondWith = (description: unknown) =>
  mocks.queryUrl.mockResolvedValue({
    transactions: [{ hash, total_fees: '1000000', description }],
  })

describe('getTonTxStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queries the incoming message hash', async () => {
    mocks.queryUrl.mockResolvedValue({ transactions: [] })

    await getTonTxStatus({ chain: OtherChain.Ton, hash })

    expect(mocks.queryUrl).toHaveBeenCalledWith(expect.stringContaining(`msg_hash=${hash}`))
  })

  it('stays pending while the indexer has no record of the message', async () => {
    mocks.queryUrl.mockResolvedValue({ transactions: [] })

    await expect(getTonTxStatus({ chain: OtherChain.Ton, hash })).resolves.toEqual({
      status: 'pending',
      isKnown: false,
    })
  })

  it('stays pending on a request failure', async () => {
    mocks.queryUrl.mockRejectedValue(new Error('network down'))

    await expect(getTonTxStatus({ chain: OtherChain.Ton, hash })).resolves.toEqual({
      status: 'pending',
      isKnown: false,
    })
  })

  it('stays pending when the transaction is indexed without execution details', async () => {
    respondWith(undefined)

    await expect(getTonTxStatus({ chain: OtherChain.Ton, hash })).resolves.toEqual({
      status: 'pending',
      isKnown: true,
    })
  })

  it('confirms a transaction that cleared both phases', async () => {
    respondWith({ type: 'ord', aborted: false, compute_ph: okComputePhase, action: okActionPhase })

    await expect(getTonTxStatus({ chain: OtherChain.Ton, hash })).resolves.toEqual({
      status: 'success',
      receipt,
    })
  })

  it('confirms a plain transfer that carries no compute phase', async () => {
    respondWith({ aborted: false, action: okActionPhase })

    await expect(getTonTxStatus({ chain: OtherChain.Ton, hash })).resolves.toEqual({
      status: 'success',
      receipt,
    })
  })

  it('treats TVM exit code 1 as success', async () => {
    respondWith({ compute_ph: { exit_code: 1 }, action: okActionPhase })

    await expect(getTonTxStatus({ chain: OtherChain.Ton, hash })).resolves.toEqual({
      status: 'success',
      receipt,
    })
  })

  it('fails an aborted transaction, explains it, and still reports the fee it burned', async () => {
    respondWith({ aborted: true, compute_ph: okComputePhase, action: okActionPhase })

    await expect(getTonTxStatus({ chain: OtherChain.Ton, hash })).resolves.toEqual({
      status: 'error',
      receipt,
      failure: { reason: 'aborted', phase: 'compute', message: expect.stringMatching(/aborted/) },
    })
  })

  it('fails a reverted compute phase and names the exit code', async () => {
    respondWith({ aborted: false, compute_ph: { exit_code: 37 }, action: okActionPhase })

    await expect(getTonTxStatus({ chain: OtherChain.Ton, hash })).resolves.toEqual({
      status: 'error',
      receipt,
      failure: {
        reason: 'contract-rejected',
        phase: 'compute',
        exitCode: 37,
        message: 'The contract rejected the transaction (exit code 37).',
      },
    })
  })

  it('explains the wallet-contract failures users actually hit: a replayed seqno and an expired deadline', async () => {
    respondWith({ aborted: true, compute_ph: { exit_code: 133 } })

    await expect(getTonTxStatus({ chain: OtherChain.Ton, hash })).resolves.toMatchObject({
      status: 'error',
      failure: { reason: 'seqno-mismatch', exitCode: 133, message: expect.stringMatching(/processed first/) },
    })

    respondWith({ aborted: true, compute_ph: { exit_code: 36 } })

    await expect(getTonTxStatus({ chain: OtherChain.Ton, hash })).resolves.toMatchObject({
      status: 'error',
      failure: { reason: 'expired', exitCode: 36, message: expect.stringMatching(/date and time/) },
    })
  })

  // The whole point of the resolver: compute succeeds, the transaction is not
  // aborted, and the seqno is consumed — but the action phase moved nothing.
  const failedActionPhases = {
    'success flag cleared': [{ ...okActionPhase, success: false }, 'action-failed'],
    'no funds to send': [{ ...okActionPhase, no_funds: true }, 'insufficient-funds'],
    'nonzero result code': [{ ...okActionPhase, result_code: 37 }, 'insufficient-funds'],
    'actions skipped': [{ ...okActionPhase, skipped_actions: 1 }, 'action-failed'],
    'result code without a success flag': [{ result_code: 37 }, 'insufficient-funds'],
    'an invalid destination': [{ ...okActionPhase, success: false, result_code: 36 }, 'invalid-destination'],
  } as const

  it.each(Object.entries(failedActionPhases))(
    'fails a transaction whose action phase reports %s',
    async (_, [action, reason]) => {
      respondWith({ type: 'ord', aborted: false, compute_ph: okComputePhase, action })

      await expect(getTonTxStatus({ chain: OtherChain.Ton, hash })).resolves.toMatchObject({
        status: 'error',
        receipt,
        failure: { reason, phase: 'action' },
      })
    }
  )

  it('omits the receipt when the indexer reports no fee', async () => {
    mocks.queryUrl.mockResolvedValue({
      transactions: [{ hash, total_fees: '', description: { action: okActionPhase } }],
    })

    await expect(getTonTxStatus({ chain: OtherChain.Ton, hash })).resolves.toEqual({
      status: 'success',
      receipt: undefined,
    })
  })
})
