import { OtherChain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getTransaction: vi.fn() }))

vi.mock('@vultisig/core-chain/chains/sui/client', () => ({
  getSuiClient: () => ({ getTransaction: mocks.getTransaction }),
}))

import { getSuiTxStatus } from './sui'

const hash = 'BWWMRhDrfnMWiLCsGqcvJZGDLGGkTKAyLQMJVGqZ4Vzq'

describe('getSuiTxStatus — unified client result union', () => {
  beforeEach(() => mocks.getTransaction.mockReset())

  it('asks for effects by digest', async () => {
    mocks.getTransaction.mockResolvedValueOnce({ $kind: 'Transaction', Transaction: {} })
    await getSuiTxStatus({ chain: OtherChain.Sui, hash })

    expect(mocks.getTransaction).toHaveBeenCalledWith({ digest: hash, include: { effects: true } })
  })

  it('reports success with a fee receipt derived from gasUsed', async () => {
    mocks.getTransaction.mockResolvedValueOnce({
      $kind: 'Transaction',
      Transaction: {
        status: { success: true, error: null },
        effects: {
          transactionDigest: hash,
          gasUsed: {
            computationCost: '1000000',
            storageCost: '2000000',
            storageRebate: '500000',
            nonRefundableStorageFee: '20000',
          },
        },
      },
    })

    await expect(getSuiTxStatus({ chain: OtherChain.Sui, hash })).resolves.toEqual({
      status: 'success',
      receipt: {
        // computation + storage - rebate; nonRefundableStorageFee is NOT part of the charge.
        feeAmount: 2_500_000n,
        feeDecimals: 9,
        feeTicker: 'SUI',
      },
    })
  })

  it('omits the receipt when the success response carries no gas breakdown', async () => {
    mocks.getTransaction.mockResolvedValueOnce({
      $kind: 'Transaction',
      Transaction: { status: { success: true, error: null }, effects: { transactionDigest: hash } },
    })

    await expect(getSuiTxStatus({ chain: OtherChain.Sui, hash })).resolves.toEqual({
      status: 'success',
      receipt: undefined,
    })
  })

  it('reports a finalized on-chain failure as error (sdk#1398)', async () => {
    mocks.getTransaction.mockResolvedValueOnce({
      $kind: 'FailedTransaction',
      FailedTransaction: {
        status: { success: false, error: { message: 'MoveAbort' } },
        effects: { transactionDigest: hash },
      },
    })

    await expect(getSuiTxStatus({ chain: OtherChain.Sui, hash })).resolves.toEqual({ status: 'error' })
  })

  it('reports error when the Transaction arm itself carries a failed status', async () => {
    mocks.getTransaction.mockResolvedValueOnce({
      $kind: 'Transaction',
      Transaction: { status: { success: false, error: { message: 'InsufficientGas' } } },
    })

    await expect(getSuiTxStatus({ chain: OtherChain.Sui, hash })).resolves.toEqual({ status: 'error' })
  })

  it('does not report success on a FailedTransaction arm that claims success', async () => {
    // Defense in depth: the arm is the authoritative signal, so a contradictory
    // status must never be upgraded to a success + fee receipt.
    mocks.getTransaction.mockResolvedValueOnce({
      $kind: 'FailedTransaction',
      FailedTransaction: { status: { success: true, error: null } },
    })

    await expect(getSuiTxStatus({ chain: OtherChain.Sui, hash })).resolves.toEqual({ status: 'error' })
  })
})
