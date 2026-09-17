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

const receipt = {
  feeAmount: 1_000_000n,
  feeDecimals: feeCoin.decimals,
  feeTicker: feeCoin.ticker,
}

const okComputePhase = {
  skipped: false,
  success: true,
  mode: 0,
  exit_code: 0,
  vm_steps: 66,
}

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

  it.each([
    ['standard base64', '5Ntg/ZmUbx80Fsc+OvEg0Ti+ZlT2JIaozUizscN0GHk='],
    ['URL-safe base64', '5Ntg_ZmUbx80Fsc-OvEg0Ti-ZlT2JIaozUizscN0GHk'],
    ['hexadecimal', 'e4db60fd99946f1f3416c73e3af120d138be6654f62486a8cd48b3b1c3741879'],
  ])('preserves the incoming %s message hash in the query', async (_, messageHash) => {
    mocks.queryUrl.mockResolvedValue({ transactions: [] })

    await getTonTxStatus({ chain: OtherChain.Ton, hash: messageHash })

    const url = new URL(mocks.queryUrl.mock.calls[0][0])
    expect(url.pathname).toBe('/ton/v3/transactionsByMessage')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      msg_hash: messageHash,
      direction: 'in',
      limit: '1',
    })
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
    respondWith({
      type: 'ord',
      aborted: false,
      compute_ph: okComputePhase,
      action: okActionPhase,
    })

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
    respondWith({
      aborted: true,
      compute_ph: okComputePhase,
      action: okActionPhase,
    })

    await expect(getTonTxStatus({ chain: OtherChain.Ton, hash })).resolves.toEqual({
      status: 'error',
      receipt,
      failure: {
        reason: 'aborted',
        phase: 'compute',
        message: expect.stringMatching(/aborted/),
      },
    })
  })

  it('fails a reverted compute phase and names the exit code', async () => {
    respondWith({
      aborted: false,
      compute_ph: { exit_code: 37 },
      action: okActionPhase,
    })

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
      failure: {
        reason: 'seqno-mismatch',
        exitCode: 133,
        message: expect.stringMatching(/processed first/),
      },
    })

    respondWith({ aborted: true, compute_ph: { exit_code: 36 } })

    await expect(getTonTxStatus({ chain: OtherChain.Ton, hash })).resolves.toMatchObject({
      status: 'error',
      failure: {
        reason: 'expired',
        exitCode: 36,
        message: expect.stringMatching(/date and time/),
      },
    })
  })

  // The whole point of the resolver: compute succeeds, the transaction is not
  // aborted, and the seqno is consumed — but the action phase moved nothing.
  const failedActionPhases = {
    'success flag cleared': [{ ...okActionPhase, success: false }, 'action-partially-failed'],
    'no funds to send': [{ ...okActionPhase, no_funds: true }, 'insufficient-funds'],
    'nonzero result code': [{ ...okActionPhase, result_code: 37 }, 'insufficient-funds'],
    'actions skipped': [{ ...okActionPhase, skipped_actions: 1 }, 'action-partially-failed'],
    'every action skipped with nothing sent': [
      { ...okActionPhase, success: false, skipped_actions: 1, msgs_created: 0 },
      'action-failed',
    ],
    'result code without a success flag': [{ result_code: 37 }, 'insufficient-funds'],
    'an invalid destination': [{ ...okActionPhase, success: false, result_code: 36 }, 'invalid-destination'],
  } as const

  it.each(Object.entries(failedActionPhases))(
    'fails a transaction whose action phase reports %s',
    async (_, [action, reason]) => {
      respondWith({
        type: 'ord',
        aborted: false,
        compute_ph: okComputePhase,
        action,
      })

      await expect(getTonTxStatus({ chain: OtherChain.Ton, hash })).resolves.toMatchObject({
        status: 'error',
        receipt,
        failure: { reason, phase: 'action' },
      })
    }
  )

  const relayedWalletTx = (description: unknown) => ({
    hash,
    total_fees: '482003',
    in_msg: { source: '0:relay', opcode: '0x73696e74' },
    description,
  })

  it('falls back to a body-hash lookup for a relayed request the message hash does not find', async () => {
    mocks.queryUrl.mockResolvedValueOnce({ transactions: [] }).mockResolvedValueOnce({
      transactions: [
        relayedWalletTx({ type: 'ord', aborted: false, compute_ph: okComputePhase, action: okActionPhase }),
      ],
    })

    // No receipt: the TON this transaction burned was the relay's, and the fee
    // the user paid is the commission the payload records.
    await expect(getTonTxStatus({ chain: OtherChain.Ton, hash })).resolves.toEqual({
      status: 'success',
      receipt: undefined,
    })

    expect(mocks.queryUrl).toHaveBeenCalledTimes(2)
    const [first, second] = mocks.queryUrl.mock.calls.map(([url]) => Object.fromEntries(new URL(url).searchParams))
    expect(first).toEqual({ msg_hash: hash, direction: 'in', limit: '1' })
    expect(second).toEqual({ body_hash: hash, direction: 'in', limit: '1' })
  })

  // The relay reports the id of the trace it broadcast the request under; the
  // wallet's own transaction is the one in that trace that received the signed
  // request, whatever else the relay and the jetton wallets did around it.
  it('resolves a relayed request by its trace id and judges the wallet transaction inside it', async () => {
    const trace = {
      trace_id: hash,
      transactions: {
        relay: {
          hash: 'r',
          total_fees: '1',
          in_msg: { source: null, opcode: '0x077ddc9e' },
          description: { aborted: false },
        },
        wallet: relayedWalletTx({
          aborted: false,
          compute_ph: okComputePhase,
          action: { ...okActionPhase, tot_actions: 2 },
        }),
        jetton: {
          hash: 'j',
          total_fees: '1',
          in_msg: { source: '0:wallet', opcode: '0x0f8a7ea5' },
          description: { aborted: false },
        },
      },
    }
    mocks.queryUrl
      .mockResolvedValueOnce({ transactions: [] })
      .mockResolvedValueOnce({ transactions: [] })
      .mockResolvedValueOnce({ traces: [trace] })

    await expect(getTonTxStatus({ chain: OtherChain.Ton, hash })).resolves.toEqual({
      status: 'success',
      receipt: undefined,
    })

    const third = new URL(mocks.queryUrl.mock.calls[2][0])
    expect(third.pathname).toBe('/ton/v3/traces')
    expect(Object.fromEntries(third.searchParams)).toEqual({ trace_id: hash })
  })

  it('also finds the trace by the hash of the message the relay broadcast', async () => {
    const trace = {
      trace_id: 'other',
      transactions: { wallet: relayedWalletTx({ aborted: true, compute_ph: { exit_code: 133 } }) },
    }
    mocks.queryUrl
      .mockResolvedValueOnce({ transactions: [] })
      .mockResolvedValueOnce({ transactions: [] })
      .mockResolvedValueOnce({ traces: [] })
      .mockResolvedValueOnce({ traces: [trace] })

    await expect(getTonTxStatus({ chain: OtherChain.Ton, hash })).resolves.toMatchObject({
      status: 'error',
      failure: { reason: 'seqno-mismatch', exitCode: 133 },
    })

    const fourth = new URL(mocks.queryUrl.mock.calls[3][0])
    expect(Object.fromEntries(fourth.searchParams)).toEqual({ msg_hash: hash })
  })

  it('stays pending, and known, while the trace exists but the wallet transaction has not landed', async () => {
    mocks.queryUrl
      .mockResolvedValueOnce({ transactions: [] })
      .mockResolvedValueOnce({ transactions: [] })
      .mockResolvedValueOnce({
        traces: [
          {
            trace_id: hash,
            transactions: { relay: { hash: 'r', total_fees: '1', in_msg: { source: null }, description: {} } },
          },
        ],
      })

    await expect(getTonTxStatus({ chain: OtherChain.Ton, hash })).resolves.toEqual({ status: 'pending', isKnown: true })
  })

  it('stays pending and unknown when neither a transaction nor a trace matches', async () => {
    mocks.queryUrl.mockResolvedValue({ transactions: [], traces: [] })

    await expect(getTonTxStatus({ chain: OtherChain.Ton, hash })).resolves.toEqual({
      status: 'pending',
      isKnown: false,
    })
    expect(mocks.queryUrl).toHaveBeenCalledTimes(4)
  })

  it('does not ask for the body hash when the message hash already matched', async () => {
    respondWith({ aborted: false, action: okActionPhase })

    await getTonTxStatus({ chain: OtherChain.Ton, hash })

    expect(mocks.queryUrl).toHaveBeenCalledTimes(1)
  })

  // W5 returns silently on a bad signature from an internal message: the
  // relay's transaction lands clean, with no action queued and nothing sent.
  it('fails a relayed request the wallet silently ignored as a signature rejection', async () => {
    mocks.queryUrl.mockResolvedValue({
      transactions: [
        {
          hash,
          total_fees: '1000000',
          in_msg: { source: '0:relay' },
          description: {
            type: 'ord',
            aborted: false,
            compute_ph: okComputePhase,
            action: { ...okActionPhase, tot_actions: 0, msgs_created: 0 },
          },
        },
      ],
    })

    await expect(getTonTxStatus({ chain: OtherChain.Ton, hash })).resolves.toMatchObject({
      status: 'error',
      receipt: undefined,
      failure: { reason: 'invalid-signature', phase: 'compute' },
    })
  })

  it('does not read a direct send with no actions as a silent rejection', async () => {
    mocks.queryUrl.mockResolvedValue({
      transactions: [
        {
          hash,
          total_fees: '1000000',
          in_msg: { source: null },
          description: {
            aborted: false,
            compute_ph: okComputePhase,
            action: { ...okActionPhase, tot_actions: 0 },
          },
        },
      ],
    })

    await expect(getTonTxStatus({ chain: OtherChain.Ton, hash })).resolves.toEqual({ status: 'success', receipt })
  })

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
