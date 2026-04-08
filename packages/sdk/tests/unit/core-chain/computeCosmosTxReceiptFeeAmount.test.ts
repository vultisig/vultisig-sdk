import { computeCosmosTxReceiptFeeAmount } from '@vultisig/core-chain/chains/cosmos/computeCosmosTxReceiptFeeAmount'
import { describe, expect, it } from 'vitest'

describe('computeCosmosTxReceiptFeeAmount', () => {
  it('uses fee gas limit when gas wanted from tx is zero (co-sign / indexer gap)', () => {
    const actual = computeCosmosTxReceiptFeeAmount({
      gasUsed: 500_000n,
      gasWantedFromTx: 0n,
      feeGasLimit: 1_000_000n,
      maxFeeAmount: 10_000n,
    })
    expect(actual).toBe(5_000n)
  })

  it('uses gas wanted when positive', () => {
    const actual = computeCosmosTxReceiptFeeAmount({
      gasUsed: 400_000n,
      gasWantedFromTx: 800_000n,
      feeGasLimit: 900_000n,
      maxFeeAmount: 8_000n,
    })
    expect(actual).toBe(4_000n)
  })

  it('falls back to gas used as denominator when wanted and fee limit are zero', () => {
    const actual = computeCosmosTxReceiptFeeAmount({
      gasUsed: 123n,
      gasWantedFromTx: 0n,
      feeGasLimit: 0n,
      maxFeeAmount: 999n,
    })
    expect(actual).toBe(999n)
  })

  it('clamps proportional fee to max fee amount', () => {
    const actual = computeCosmosTxReceiptFeeAmount({
      gasUsed: 200n,
      gasWantedFromTx: 100n,
      feeGasLimit: 0n,
      maxFeeAmount: 100n,
    })
    expect(actual).toBe(100n)
  })

  it('returns undefined when gas used or max fee is zero', () => {
    expect(
      computeCosmosTxReceiptFeeAmount({
        gasUsed: 0n,
        gasWantedFromTx: 1n,
        feeGasLimit: 1n,
        maxFeeAmount: 100n,
      })
    ).toBeUndefined()
    expect(
      computeCosmosTxReceiptFeeAmount({
        gasUsed: 1n,
        gasWantedFromTx: 1n,
        feeGasLimit: 1n,
        maxFeeAmount: 0n,
      })
    ).toBeUndefined()
  })
})
