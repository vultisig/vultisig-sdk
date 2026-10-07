import { Chain } from '@vultisig/core-chain/Chain'
import { buildNearSignedTransfer, setupTransport } from '@vultisig/core-chain/chains/near/__tests__/nearRpcTestKit'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { broadcastTx } from '../index'

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({ queryUrl: vi.fn() }))

beforeEach(() => {
  vi.mocked(queryUrl).mockReset()
})

describe('NEAR broadcast binding', () => {
  const { expectedHash, signingOutput } = buildNearSignedTransfer()

  it('accepts the node acknowledgment that matches the locally derived hash', async () => {
    setupTransport({ sendTx: { final_execution_status: 'INCLUDED', transaction: { hash: expectedHash } } })

    await expect(broadcastTx({ chain: Chain.Near, tx: signingOutput })).resolves.toMatchObject({
      status: 'accepted',
      finality: 'pending',
      txHash: expectedHash,
    })
  })

  it('fails a mismatched hash instead of reporting someone else s transaction', async () => {
    setupTransport({
      sendTx: {
        final_execution_status: 'INCLUDED',
        transaction: { hash: 'BB5kGq7xVbyw5kfMrRtYmbuUoWKqnNA6xeRU187RF7kx' },
      },
    })

    await expect(broadcastTx({ chain: Chain.Near, tx: signingOutput })).resolves.toMatchObject({
      status: 'failed',
      retryable: false,
    })
  })

  it('does not treat a definitive rejection as an accepted broadcast', async () => {
    setupTransport({
      sendTxError: {
        name: 'INVALID_TRANSACTION',
        cause: { name: 'INVALID_TRANSACTION' },
        code: -32000,
        message: 'Invalid transaction',
        data: 'nonce too small',
      },
    })

    await expect(broadcastTx({ chain: Chain.Near, tx: signingOutput })).resolves.toMatchObject({
      status: 'failed',
      retryable: false,
    })
  })

  it('verifies an ambiguous timeout against the chain instead of assuming success', async () => {
    setupTransport({
      sendTxError: {
        name: 'HANDLER_ERROR',
        cause: { name: 'TIMEOUT_ERROR' },
        code: -32000,
        message: 'Server error',
        data: 'Timeout',
      },
      status: {
        final_execution_status: 'FINAL',
        status: { SuccessValue: '' },
        transaction: { hash: expectedHash },
      },
    })

    await expect(broadcastTx({ chain: Chain.Near, tx: signingOutput })).resolves.toMatchObject({
      status: 'accepted',
      txHash: expectedHash,
    })
  })

  it('keeps a timeout failed when the chain does not know the transaction', async () => {
    setupTransport({
      sendTxError: {
        name: 'HANDLER_ERROR',
        cause: { name: 'TIMEOUT_ERROR' },
        code: -32000,
        message: 'Server error',
        data: 'Timeout',
      },
      status: { final_execution_status: 'NONE' },
    })

    await expect(broadcastTx({ chain: Chain.Near, tx: signingOutput })).resolves.toMatchObject({ status: 'failed' })
  })
})
