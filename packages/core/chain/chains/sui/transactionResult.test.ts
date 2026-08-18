import { GrpcTypes, parseGrpcTransactionResponse } from '@mysten/sui/grpc'
import { describe, expect, it } from 'vitest'

import { describeSuiExecutionFailure, getSuiResultTransaction, isSuiExecutionSuccess } from './transactionResult'

const success = {
  $kind: 'Transaction' as const,
  Transaction: { digest: '0xok', status: { success: true, error: null }, effects: { transactionDigest: '0xok' } },
}

const failure = {
  $kind: 'FailedTransaction' as const,
  FailedTransaction: {
    digest: '0xbad',
    status: { success: false, error: { message: 'MoveAbort(...) in command 0' } },
    effects: { transactionDigest: '0xbad' },
  },
}

describe('getSuiResultTransaction', () => {
  it('reads the transaction off either arm of the union', () => {
    expect(getSuiResultTransaction(success)?.digest).toBe('0xok')
    // A failed transaction still carries effects — gas refinement and broadcast
    // hash-verification both depend on being able to read them.
    expect(getSuiResultTransaction(failure)?.effects?.transactionDigest).toBe('0xbad')
  })

  it('returns undefined for a null/empty result', () => {
    expect(getSuiResultTransaction(null)).toBeUndefined()
    expect(getSuiResultTransaction(undefined)).toBeUndefined()
    expect(getSuiResultTransaction({})).toBeUndefined()
  })
})

describe('isSuiExecutionSuccess — fails closed (sdk#1398)', () => {
  it('is true only for a Transaction arm with an explicit success status', () => {
    expect(isSuiExecutionSuccess(success)).toBe(true)
  })

  it.each([
    ['a failed arm', failure],
    [
      'a failed status on the success arm',
      { $kind: 'Transaction' as const, Transaction: { status: { success: false } } },
    ],
    ['a missing status', { $kind: 'Transaction' as const, Transaction: { digest: '0xok' } }],
    [
      'a success status on the failed arm',
      { $kind: 'FailedTransaction' as const, FailedTransaction: { status: { success: true } } },
    ],
    ['a result with no discriminant', { Transaction: { status: { success: true } } }],
    ['an empty result', {}],
    ['null', null],
  ])('is false for %s', (_label, result) => {
    expect(isSuiExecutionSuccess(result)).toBe(false)
  })
})

describe('isSuiExecutionSuccess — @mysten/sui parser contract', () => {
  const parseTransaction = (success?: boolean) =>
    parseGrpcTransactionResponse(
      GrpcTypes.ExecutedTransaction.create({
        digest: 'parsed-digest',
        effects:
          success === undefined
            ? undefined
            : GrpcTypes.TransactionEffects.create({
                transactionDigest: 'parsed-effects-digest',
                gasUsed: GrpcTypes.GasCostSummary.create({
                  computationCost: 11n,
                  storageCost: 22n,
                  storageRebate: 3n,
                  nonRefundableStorageFee: 1n,
                }),
                status: GrpcTypes.ExecutionStatus.create({
                  success,
                  error: success
                    ? undefined
                    : GrpcTypes.ExecutionError.create({ description: 'MoveAbort(...) in command 0' }),
                }),
              }),
      }),
      { include: { effects: true } }
    )

  it('classifies the library parser output for success, failure, and missing effects', () => {
    const parsedSuccess = parseTransaction(true)
    const parsedFailure = parseTransaction(false)
    const parsedWithoutEffects = parseTransaction()

    expect(parsedSuccess).toMatchObject({
      $kind: 'Transaction',
      Transaction: {
        digest: 'parsed-digest',
        status: { success: true, error: null },
        effects: {
          transactionDigest: 'parsed-effects-digest',
          gasUsed: {
            computationCost: '11',
            storageCost: '22',
            storageRebate: '3',
            nonRefundableStorageFee: '1',
          },
        },
      },
    })
    expect(parsedFailure).toMatchObject({
      $kind: 'FailedTransaction',
      FailedTransaction: {
        status: {
          success: false,
          error: { $kind: 'Unknown', message: 'MoveAbort(...) in command 0' },
        },
        effects: {
          transactionDigest: 'parsed-effects-digest',
          gasUsed: { computationCost: '11', storageCost: '22', storageRebate: '3' },
        },
      },
    })
    expect(parsedWithoutEffects).toMatchObject({
      $kind: 'FailedTransaction',
      FailedTransaction: {
        status: { success: false, error: { $kind: 'Unknown', message: 'Transaction failed' } },
        effects: null,
      },
    })

    expect([
      isSuiExecutionSuccess(parsedSuccess),
      isSuiExecutionSuccess(parsedFailure),
      isSuiExecutionSuccess(parsedWithoutEffects),
    ]).toEqual([true, false, false])
  })
})

describe('describeSuiExecutionFailure', () => {
  it('prefers the chain-supplied error message', () => {
    expect(describeSuiExecutionFailure(failure)).toBe('MoveAbort(...) in command 0')
  })

  it('describes a failed status with no message', () => {
    expect(describeSuiExecutionFailure({ $kind: 'Transaction', Transaction: { status: { success: false } } })).toBe(
      'execution failed'
    )
  })

  it('describes a failed arm with no status at all', () => {
    expect(describeSuiExecutionFailure({ $kind: 'FailedTransaction', FailedTransaction: {} })).toBe(
      'transaction did not execute'
    )
  })

  it('describes a response that carries no status information', () => {
    expect(describeSuiExecutionFailure({})).toBe('no execution status returned')
  })
})
