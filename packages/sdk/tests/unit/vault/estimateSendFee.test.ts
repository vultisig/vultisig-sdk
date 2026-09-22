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

  it('reports the jetton as the fee asset for a gasless TON send, and TON otherwise', async () => {
    const estimateSendFee = vi.fn().mockResolvedValue(7_000n)
    const usdt = {
      chain: Chain.Ton,
      address: 'UQsender',
      id: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs',
      decimals: 6,
      ticker: 'USDT',
    }

    await expect(
      callPublicEstimate(
        { estimateSendFee },
        { coin: usdt, receiver: 'UQreceiver', amount: 25_000_000n, tonGasless: true }
      )
    ).resolves.toEqual({ feeAmountBase: 7_000n, feeDecimals: 6, feeSymbol: 'USDT' })
    expect(estimateSendFee).toHaveBeenLastCalledWith(expect.objectContaining({ tonGasless: true }))

    estimateSendFee.mockResolvedValue(90_000_000n)
    await expect(
      callPublicEstimate({ estimateSendFee }, { coin: usdt, receiver: 'UQreceiver', amount: 25_000_000n })
    ).resolves.toMatchObject({ feeAmountBase: 90_000_000n, feeDecimals: 9 })
  })

  it('forwards allowDeath so the estimate prices the transfer_allow_death call', async () => {
    const estimateSendFee = vi.fn().mockResolvedValue(1_560_000_000n)
    const dot = { chain: Chain.Polkadot, address: '1sender', decimals: 10, ticker: 'DOT' }

    await expect(
      callPublicEstimate(
        { estimateSendFee },
        { coin: dot, receiver: '1receiver', amount: 5_000_000_000n, allowDeath: true }
      )
    ).resolves.toEqual({ feeAmountBase: 1_560_000_000n, feeDecimals: 10, feeSymbol: 'DOT' })
    expect(estimateSendFee).toHaveBeenCalledOnce()
    expect(estimateSendFee).toHaveBeenCalledWith(expect.objectContaining({ allowDeath: true }))
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
