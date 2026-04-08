import { CosmosChain } from '@vultisig/core-chain/Chain'
import { sumFeeAmountForCosmosChainFeeDenom } from '@vultisig/core-chain/chains/cosmos/sumFeeAmountForCosmosChainFeeDenom'
import { describe, expect, it } from 'vitest'

describe('sumFeeAmountForCosmosChainFeeDenom', () => {
  it('returns null for undefined or empty amounts', () => {
    expect(
      sumFeeAmountForCosmosChainFeeDenom({
        amounts: undefined,
        chain: CosmosChain.THORChain,
      })
    ).toBeNull()
    expect(
      sumFeeAmountForCosmosChainFeeDenom({
        amounts: [],
        chain: CosmosChain.THORChain,
      })
    ).toBeNull()
  })

  it('returns null when no denom matches the chain fee denom', () => {
    expect(
      sumFeeAmountForCosmosChainFeeDenom({
        amounts: [{ denom: 'ibc/OTHER', amount: '1000' }],
        chain: CosmosChain.THORChain,
      })
    ).toBeNull()
  })

  it('matches THORChain native denom case-insensitively and sums', () => {
    expect(
      sumFeeAmountForCosmosChainFeeDenom({
        amounts: [{ denom: 'RUNE', amount: '100' }],
        chain: CosmosChain.THORChain,
      })
    ).toBe(100n)
    expect(
      sumFeeAmountForCosmosChainFeeDenom({
        amounts: [
          { denom: 'rune', amount: '50' },
          { denom: 'RUNE', amount: '25' },
        ],
        chain: CosmosChain.THORChain,
      })
    ).toBe(75n)
  })

  it('sums only entries that match the chain fee denom', () => {
    expect(
      sumFeeAmountForCosmosChainFeeDenom({
        amounts: [
          { denom: 'uatom', amount: '999' },
          { denom: 'ibc/FOO', amount: '1' },
        ],
        chain: CosmosChain.Cosmos,
      })
    ).toBe(999n)
  })

  it('does not match denoms that only share a substring with the fee denom', () => {
    expect(
      sumFeeAmountForCosmosChainFeeDenom({
        amounts: [{ denom: 'xrune', amount: '100' }],
        chain: CosmosChain.THORChain,
      })
    ).toBeNull()
  })
})
