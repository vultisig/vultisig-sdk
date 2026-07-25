import { describe, expect, it } from 'vitest'

import { IBC_GAS_MULTIPLIER, resolveCosmosGasLimit, scaleCosmosFeeAmount } from './resolveCosmosGasLimit.js'

describe('resolveCosmosGasLimit', () => {
  const staticGasLimit = 200_000n

  it('falls back to the static limit when no dynamic limit is relayed', () => {
    expect(resolveCosmosGasLimit({ relayedGasLimit: undefined, staticGasLimit })).toBe(staticGasLimit)
  })

  it('treats a zero relayed limit as unset', () => {
    expect(resolveCosmosGasLimit({ relayedGasLimit: 0n, staticGasLimit })).toBe(staticGasLimit)
  })

  it('honors a relayed limit below the static limit', () => {
    expect(resolveCosmosGasLimit({ relayedGasLimit: 100_000n, staticGasLimit })).toBe(100_000n)
  })

  it('honors a relayed limit above the static limit', () => {
    expect(resolveCosmosGasLimit({ relayedGasLimit: 345_678n, staticGasLimit })).toBe(345_678n)
  })
})

describe('scaleCosmosFeeAmount', () => {
  const fromGasLimit = 200_000n
  const feeAmount = 7500n

  it('returns the amount unchanged when the limit is unchanged', () => {
    expect(scaleCosmosFeeAmount({ feeAmount, fromGasLimit, toGasLimit: fromGasLimit })).toBe(feeAmount)
  })

  it('returns the amount unchanged when the reference limit is zero', () => {
    expect(scaleCosmosFeeAmount({ feeAmount, fromGasLimit: 0n, toGasLimit: 400_000n })).toBe(feeAmount)
  })

  it('scales proportionally', () => {
    // 7500 * 400000 / 200000 = 15000 exactly
    expect(scaleCosmosFeeAmount({ feeAmount, fromGasLimit, toGasLimit: 400_000n })).toBe(15_000n)
  })

  it('rounds up so the scaled amount never lands below gasLimit × price', () => {
    // 7500 * 300001 / 200000 = 11250.0375 -> ceil 11251
    expect(scaleCosmosFeeAmount({ feeAmount, fromGasLimit, toGasLimit: 300_001n })).toBe(11_251n)
  })

  it('matches iOS CosmosGasPricedFee.scaled on the TerraClassic uluna base', () => {
    // iOS: ulunaBaseGas 8_497_500 priced at staticGasLimit 300_000, scaled to 450_000
    // -> ceil(8_497_500 * 450_000 / 300_000) = 12_746_250
    expect(scaleCosmosFeeAmount({ feeAmount: 8_497_500n, fromGasLimit: 300_000n, toGasLimit: 450_000n })).toBe(
      12_746_250n
    )
  })

  it('exposes the IBC source-leg multiplier the initiator applies', () => {
    expect(IBC_GAS_MULTIPLIER).toBe(2n)
  })
})
