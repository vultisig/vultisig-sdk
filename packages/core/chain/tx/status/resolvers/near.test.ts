import { Chain } from '@vultisig/core-chain/Chain'
import { NAMED_RECEIVER, SENDER, setupTransport } from '@vultisig/core-chain/chains/near/__tests__/nearRpcTestKit'
import { NearRpcError } from '@vultisig/core-chain/chains/near/rpc'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getTxStatus } from '../index'

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({ queryUrl: vi.fn() }))

beforeEach(() => {
  vi.mocked(queryUrl).mockReset()
})

describe('NEAR finality status', () => {
  const hash = 'BB5kGq7xVbyw5kfMrRtYmbuUoWKqnNA6xeRU187RF7kx'

  it('binds success to a final execution outcome for the same hash', async () => {
    setupTransport({
      status: { final_execution_status: 'FINAL', status: { SuccessValue: '' }, transaction: { hash } },
    })

    await expect(getTxStatus({ chain: Chain.Near, hash, senderAccountId: SENDER })).resolves.toMatchObject({
      status: 'success',
      isKnown: true,
    })
  })

  it('refuses a final outcome that does not name its transaction', async () => {
    setupTransport({ status: { final_execution_status: 'FINAL', status: { SuccessValue: '' } } })

    await expect(getTxStatus({ chain: Chain.Near, hash, senderAccountId: SENDER })).rejects.toThrow(
      'without the transaction hash'
    )
  })

  it('reports an executed failure as an error, not a success', async () => {
    setupTransport({
      status: {
        final_execution_status: 'FINAL',
        status: {
          Failure: { ActionError: { index: 0, kind: { AccountAlreadyExists: { account_id: NAMED_RECEIVER } } } },
        },
        transaction: { hash },
      },
    })

    await expect(getTxStatus({ chain: Chain.Near, hash, senderAccountId: SENDER })).resolves.toMatchObject({
      status: 'error',
    })
  })

  it.each([['NONE'], ['INCLUDED'], ['EXECUTED_OPTIMISTIC'], ['EXECUTED']])(
    'never reports %s as success',
    async finalExecutionStatus => {
      setupTransport({
        status: { final_execution_status: finalExecutionStatus, status: { SuccessValue: '' }, transaction: { hash } },
      })

      await expect(getTxStatus({ chain: Chain.Near, hash, senderAccountId: SENDER })).resolves.toMatchObject({
        status: 'pending',
      })
    }
  )

  it('reports an unknown hash as not found', async () => {
    setupTransport({
      statusError: {
        name: 'HANDLER_ERROR',
        cause: { name: 'UNKNOWN_TRANSACTION' },
        code: -32000,
        message: 'Server error',
        data: 'Transaction does not exist',
      },
    })

    await expect(getTxStatus({ chain: Chain.Near, hash, senderAccountId: SENDER })).resolves.toMatchObject({
      status: 'not_found',
      isKnown: false,
    })
  })

  it('reports an unknown hash as not found when the endpoint drops the error name', async () => {
    // Verbatim from api.vultisig.com/near/ (2026-10-21).
    setupTransport({
      statusError: { code: -32000, message: 'Server error', data: `Transaction ${hash} doesn't exist` },
    })

    await expect(getTxStatus({ chain: Chain.Near, hash, senderAccountId: SENDER })).resolves.toMatchObject({
      status: 'not_found',
      isKnown: false,
    })
  })

  it('asks for what the node knows now, since any wait turns an unknown hash into a timeout', async () => {
    setupTransport({
      status: { final_execution_status: 'FINAL', status: { SuccessValue: '' }, transaction: { hash } },
    })

    await getTxStatus({ chain: Chain.Near, hash, senderAccountId: SENDER })

    expect(queryUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: expect.objectContaining({ method: 'tx', params: expect.objectContaining({ wait_until: 'NONE' }) }),
      })
    )
  })

  it('propagates a name-less upstream failure instead of reporting not found or pending', async () => {
    // What api.vultisig.com/near/ answers when its upstream gives up (2026-10-21).
    setupTransport({ statusError: { code: -32603, message: 'Internal error', data: 'upstream request failed' } })

    await expect(getTxStatus({ chain: Chain.Near, hash, senderAccountId: SENDER })).rejects.toThrow(/UNKNOWN_ERROR/)
  })

  it('keeps an unanswered lookup pending rather than claiming it failed', async () => {
    setupTransport({
      statusError: {
        name: 'HANDLER_ERROR',
        cause: { name: 'TIMEOUT_ERROR' },
        code: -32000,
        message: 'Server error',
        data: 'Timeout',
      },
    })

    await expect(getTxStatus({ chain: Chain.Near, hash, senderAccountId: SENDER })).resolves.toMatchObject({
      status: 'pending',
      isKnown: false,
    })
  })

  it('fails closed without the sender the node needs, and propagates malformed status', async () => {
    setupTransport({})

    await expect(getTxStatus({ chain: Chain.Near, hash })).rejects.toThrow(/sender/)

    setupTransport({ status: { final_execution_status: 'FINAL', status: { UnknownOutcome: {} } } })
    await expect(getTxStatus({ chain: Chain.Near, hash, senderAccountId: SENDER })).rejects.toThrow(/unrecognized/)
  })

  it('propagates a status RPC failure instead of reporting pending', async () => {
    vi.mocked(queryUrl).mockRejectedValue(new NearRpcError('tx', 'INTERNAL_ERROR', 'node is behind', undefined))

    await expect(getTxStatus({ chain: Chain.Near, hash, senderAccountId: SENDER })).rejects.toThrow(/INTERNAL_ERROR/)
  })
})
