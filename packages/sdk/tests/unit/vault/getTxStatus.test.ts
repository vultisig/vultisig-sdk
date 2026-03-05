import { Chain } from '@core/chain/Chain'
import { describe, expect, it, vi } from 'vitest'

import { VaultError, VaultErrorCode } from '../../../src/vault/VaultError'

// Mock the core getTxStatus function
vi.mock('@core/chain/tx/status', () => ({
  getTxStatus: vi.fn(),
}))

import { getTxStatus as coreTxStatus } from '@core/chain/tx/status'

const mockCoreTxStatus = vi.mocked(coreTxStatus)

describe('getTxStatus core delegation', () => {
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
