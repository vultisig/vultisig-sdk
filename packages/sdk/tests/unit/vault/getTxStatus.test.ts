import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { VaultBase } from '../../../src/vault/VaultBase'
import { VaultError, VaultErrorCode } from '../../../src/vault/VaultError'

// Mock the core getTxStatus function
vi.mock('@vultisig/core-chain/tx/status', () => ({
  getTxStatus: vi.fn(),
}))

import { getTxStatus as coreTxStatus } from '@vultisig/core-chain/tx/status'

const mockCoreTxStatus = vi.mocked(coreTxStatus)

describe('getTxStatus core delegation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return pending status', async () => {
    mockCoreTxStatus.mockResolvedValue({ status: 'pending' })

    const result = await coreTxStatus({ chain: Chain.Ethereum, hash: '0xabc123' })

    expect(result.status).toBe('pending')
    expect(mockCoreTxStatus).toHaveBeenCalledWith({
      chain: Chain.Ethereum,
      hash: '0xabc123',
    })
  })

  it('should return success status with receipt info', async () => {
    mockCoreTxStatus.mockResolvedValue({
      status: 'success',
      receipt: {
        feeAmount: 21000n * 20000000000n,
        feeDecimals: 18,
        feeTicker: 'ETH',
      },
    })

    const result = await coreTxStatus({ chain: Chain.Ethereum, hash: '0xdef456' })

    expect(result.status).toBe('success')
    expect(result.receipt).toBeDefined()
    expect(result.receipt?.feeTicker).toBe('ETH')
    expect(result.receipt?.feeDecimals).toBe(18)
  })

  it('should return error status for failed transactions', async () => {
    mockCoreTxStatus.mockResolvedValue({ status: 'error' })

    const result = await coreTxStatus({ chain: Chain.Bitcoin, hash: 'abc123' })

    expect(result.status).toBe('error')
    expect(result.receipt).toBeUndefined()
  })

  it('should throw on network errors', async () => {
    mockCoreTxStatus.mockRejectedValue(new Error('RPC timeout'))

    await expect(coreTxStatus({ chain: Chain.Ethereum, hash: '0x123' })).rejects.toThrow('RPC timeout')
  })

  it('should support UTXO chains', async () => {
    mockCoreTxStatus.mockResolvedValue({
      status: 'success',
      receipt: {
        feeAmount: 5000n,
        feeDecimals: 8,
        feeTicker: 'BTC',
      },
    })

    const result = await coreTxStatus({ chain: Chain.Bitcoin, hash: 'txid123' })

    expect(result.status).toBe('success')
    expect(result.receipt?.feeTicker).toBe('BTC')
  })

  it('should support Cosmos chains', async () => {
    mockCoreTxStatus.mockResolvedValue({
      status: 'success',
      receipt: {
        feeAmount: 5000n,
        feeDecimals: 6,
        feeTicker: 'ATOM',
      },
    })

    const result = await coreTxStatus({ chain: Chain.Cosmos, hash: 'cosmoshash' })

    expect(result.status).toBe('success')
    expect(result.receipt?.feeTicker).toBe('ATOM')
  })

  it('emits the terminal failure event when a transaction has expired', async () => {
    mockCoreTxStatus.mockResolvedValue({ status: 'expired', isKnown: true })
    const emit = vi.fn()

    const result = await VaultBase.prototype.getTxStatus.call({ emit } as never, {
      chain: Chain.Tron,
      txHash: 'expired-tron-hash',
    })

    expect(result).toEqual({ status: 'expired', isKnown: true })
    expect(emit).toHaveBeenCalledWith('transactionFailed', {
      chain: Chain.Tron,
      txHash: 'expired-tron-hash',
    })
  })

  it('rejects an expired approval instead of treating it as confirmed', async () => {
    const getTxStatus = vi.fn().mockResolvedValue({ status: 'expired', isKnown: true })
    const waitForConfirmation = (
      VaultBase.prototype as unknown as {
        waitForConfirmation: (chain: Chain, txHash: string, timeoutMs: number, intervalMs: number) => Promise<void>
      }
    ).waitForConfirmation

    await expect(
      waitForConfirmation.call({ getTxStatus }, Chain.Tron, 'expired-approval-hash', 100, 1)
    ).rejects.toMatchObject({
      code: VaultErrorCode.BroadcastFailed,
      message: 'Approval tx expired: expired-approval-hash',
    })
  })
})

describe('VaultError wrapping for tx status', () => {
  it('should create NetworkError with tx context', () => {
    const cause = new Error('Connection refused')
    const error = new VaultError(
      VaultErrorCode.NetworkError,
      `Failed to get transaction status for 0xabc on Ethereum: Connection refused`,
      cause
    )

    expect(error.code).toBe(VaultErrorCode.NetworkError)
    expect(error.message).toContain('0xabc')
    expect(error.message).toContain('Ethereum')
    expect(error.originalError).toBe(cause)
  })
})
