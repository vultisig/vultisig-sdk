import { Chain } from '@vultisig/core-chain/Chain'
import { SwapQuote } from '@vultisig/core-chain/swap/quote/SwapQuote'
import { SwapFee } from '@vultisig/core-chain/swap/SwapFee'
import { describe, expect, it, vi } from 'vitest'

import { extractSwapFees } from '../../../src/vault/services/swap/extractFees'

const affiliate: SwapFee = { amount: 25n, decimals: 18, chain: Chain.Ethereum }
const quote = (gasLimit: bigint | undefined, fee: SwapFee | undefined = affiliate): SwapQuote['quote'] => ({
  general: {
    dstAmount: '100',
    provider: '1inch',
    tx: { evm: { from: '0x123', to: '0x456', data: '0x', value: '0', gasLimit, affiliateFee: fee } },
  },
})
const rates = () => ({
  getBaseFee: vi.fn().mockResolvedValue(10n),
  getMaxPriorityFeePerGas: vi.fn().mockResolvedValue(2n),
})

describe('EVM swap fee extraction', () => {
  it.each([undefined, 0n])('preserves known affiliate fees without gas (%s)', async gasLimit => {
    const feeRates = rates()
    expect(await extractSwapFees(quote(gasLimit), Chain.Ethereum, feeRates)).toEqual({
      network: 0n,
      affiliate: 25n,
      total: 25n,
    })
    expect(feeRates.getBaseFee).not.toHaveBeenCalled()
    expect(feeRates.getMaxPriorityFeePerGas).not.toHaveBeenCalled()
  })

  it.each(['getBaseFee', 'getMaxPriorityFeePerGas'] as const)('preserves affiliate when %s fails', async key => {
    const feeRates = rates()
    feeRates[key].mockRejectedValue(new Error('RPC unavailable'))
    expect(await extractSwapFees(quote(100n), Chain.Ethereum, feeRates)).toEqual({
      network: 0n,
      affiliate: 25n,
      total: 25n,
    })
  })

  it('sums network and affiliate fees when the estimate succeeds', async () => {
    expect(await extractSwapFees(quote(100n), Chain.Ethereum, rates())).toEqual({
      network: 1200n,
      affiliate: 25n,
      total: 1225n,
    })
  })

  it.each([
    { ...affiliate, id: '0xToken' },
    { ...affiliate, chain: Chain.Arbitrum },
  ])('does not sum a fee in another denomination', async fee => {
    expect(await extractSwapFees(quote(undefined, fee), Chain.Ethereum, rates())).toEqual({
      network: 0n,
      affiliate: undefined,
      total: 0n,
    })
  })

  it('does not call EVM fee providers for another chain kind', async () => {
    const feeRates = rates()
    expect(await extractSwapFees(quote(100n), Chain.Bitcoin, feeRates)).toEqual({
      network: 0n,
      affiliate: undefined,
      total: 0n,
    })
    expect(feeRates.getBaseFee).not.toHaveBeenCalled()
  })
})
