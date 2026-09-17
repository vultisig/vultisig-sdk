import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it, vi } from 'vitest'

import { VaultBase } from '@/vault/VaultBase'

const callPublicEstimate = (
  transactionBuilder: { estimateSendFee: ReturnType<typeof vi.fn> },
  params: Parameters<VaultBase['estimateSendFee']>[0]
) => VaultBase.prototype.estimateSendFee.call({ transactionBuilder } as unknown as VaultBase, params)

describe('VaultBase.estimateSendFee', () => {
  it('is exposed on the public vault prototype', () => {
    expect(typeof VaultBase.prototype.estimateSendFee).toBe('function')
  })

  it('forwards every estimator input unchanged exactly once', async () => {
    const estimateSendFee = vi.fn().mockResolvedValue(21_000_000_000_000n)
    const params = {
      coin: {
        chain: Chain.Ethereum,
        address: '0x58C4a1F319297EC9c398A0F3a3b64AF5a18b5C35',
        id: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        decimals: 6,
        ticker: 'USDC',
      },
      receiver: '0x1111111111111111111111111111111111111111',
      amount: 1_000_000n,
      memo: 'public API fee preview',
      destinationTag: 7,
      feeSettings: { maxPriorityFeePerGas: 1_000_000_000n, gasLimit: 21_000n },
    }

    await expect(callPublicEstimate({ estimateSendFee }, params)).resolves.toEqual({
      feeAmountBase: 21_000_000_000_000n,
      feeDecimals: 18,
      feeSymbol: 'ETH',
    })
    expect(estimateSendFee).toHaveBeenCalledOnce()
    expect(estimateSendFee).toHaveBeenCalledWith(params)
  })

  it('reports the native fee asset for UTXO sends', async () => {
    const estimateSendFee = vi.fn().mockResolvedValue(500n)
    const params = {
      coin: { chain: Chain.Bitcoin, address: 'bc1qsender', decimals: 8, ticker: 'BTC' },
      receiver: 'bc1qreceiver',
      amount: 10_000n,
    }

    await expect(callPublicEstimate({ estimateSendFee }, params)).resolves.toEqual({
      feeAmountBase: 500n,
      feeDecimals: 8,
      feeSymbol: 'BTC',
    })
  })

  it('preserves estimator failures', async () => {
    const error = new Error('fee provider unavailable')
    const estimateSendFee = vi.fn().mockRejectedValue(error)
    const params = {
      coin: { chain: Chain.Ethereum, address: '0xsender', decimals: 18, ticker: 'ETH' },
      receiver: '0xreceiver',
      amount: 1n,
    }

    await expect(callPublicEstimate({ estimateSendFee }, params)).rejects.toBe(error)
  })
})
