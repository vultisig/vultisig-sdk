import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ simulateTransaction: vi.fn() }))

vi.mock('@vultisig/core-chain/chains/sui/client', () => ({
  getSuiClient: () => ({ simulateTransaction: mocks.simulateTransaction }),
}))

import { getSuiTxHash } from './sui'

const digest = 'BWWMRhDrfnMWiLCsGqcvJZGDLGGkTKAyLQMJVGqZ4Vzq'
// base64 of 'tx-block'
const unsignedTx = 'dHgtYmxvY2s='
const tx = { unsignedTx } as never

describe('getSuiTxHash — simulateTransaction replaces dryRunTransactionBlock', () => {
  beforeEach(() => mocks.simulateTransaction.mockReset())

  it('simulates with decoded BCS bytes and returns the effects digest', async () => {
    mocks.simulateTransaction.mockResolvedValueOnce({
      $kind: 'Transaction',
      Transaction: { status: { success: true, error: null }, effects: { transactionDigest: digest } },
    })

    await expect(getSuiTxHash(tx)).resolves.toBe(digest)

    const request = mocks.simulateTransaction.mock.calls[0]?.[0]
    // The unified API takes raw bytes, not the base64 string JSON-RPC accepted.
    expect(request.transaction).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(request.transaction)).toBe('tx-block')
    expect(request.include).toEqual({ effects: true })
  })

  it('still returns the digest when the simulation itself fails execution', async () => {
    // A simulated MoveAbort still produces effects with a digest — and broadcast
    // hash-verification needs exactly that digest to look the tx up on-chain.
    mocks.simulateTransaction.mockResolvedValueOnce({
      $kind: 'FailedTransaction',
      FailedTransaction: {
        status: { success: false, error: { message: 'MoveAbort' } },
        effects: { transactionDigest: digest },
      },
    })

    await expect(getSuiTxHash(tx)).resolves.toBe(digest)
  })

  it('throws rather than returning an empty hash when no digest comes back', async () => {
    // `digest` (top level) is NOT populated for a simulation — only the effects
    // carry it. Reading the wrong field must fail loudly, not yield undefined.
    mocks.simulateTransaction.mockResolvedValueOnce({
      $kind: 'Transaction',
      Transaction: { digest, status: { success: true, error: null } },
    })

    await expect(getSuiTxHash(tx)).rejects.toThrow()
  })
})
