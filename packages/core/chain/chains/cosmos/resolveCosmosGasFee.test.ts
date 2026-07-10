import { describe, expect, it } from 'vitest'

import { resolveCosmosGasFee } from './resolveCosmosGasFee.js'

describe('resolveCosmosGasFee', () => {
  const staticGasLimit = 200_000n
  const gas = 7500n

  it('keeps the static limit and fee when no dynamic limit is relayed', () => {
    expect(resolveCosmosGasFee({ gas, relayedGasLimit: undefined, staticGasLimit })).toEqual({
      resolvedGasLimit: staticGasLimit,
      feeAmount: gas,
    })
  })

  it('ignores a zero relayed limit (fall back to static)', () => {
    expect(resolveCosmosGasFee({ gas, relayedGasLimit: 0n, staticGasLimit })).toEqual({
      resolvedGasLimit: staticGasLimit,
      feeAmount: gas,
    })
  })

  it('leaves the fee untouched when the relayed limit is below the static limit', () => {
    expect(resolveCosmosGasFee({ gas, relayedGasLimit: 100_000n, staticGasLimit })).toEqual({
      resolvedGasLimit: 100_000n,
      feeAmount: gas,
    })
  })

  it('leaves the fee untouched when the relayed limit equals the static limit', () => {
    expect(resolveCosmosGasFee({ gas, relayedGasLimit: staticGasLimit, staticGasLimit })).toEqual({
      resolvedGasLimit: staticGasLimit,
      feeAmount: gas,
    })
  })

  it('scales the fee proportionally (ceiling) when the relayed limit exceeds the static limit', () => {
    // 7500 * 400000 / 200000 = 15000 exactly
    expect(resolveCosmosGasFee({ gas, relayedGasLimit: 400_000n, staticGasLimit })).toEqual({
      resolvedGasLimit: 400_000n,
      feeAmount: 15_000n,
    })
  })

  it('rounds the scaled fee up', () => {
    // 7500 * 300001 / 200000 = 11250.0375 -> ceil 11251
    expect(resolveCosmosGasFee({ gas, relayedGasLimit: 300_001n, staticGasLimit })).toEqual({
      resolvedGasLimit: 300_001n,
      feeAmount: 11_251n,
    })
  })

  describe('COSMOS-02: isIbcTransfer', () => {
    it('leaves the gas limit and fee unchanged when isIbcTransfer is omitted (non-IBC messages keep the flat fee)', () => {
      expect(resolveCosmosGasFee({ gas, relayedGasLimit: undefined, staticGasLimit })).toEqual({
        resolvedGasLimit: staticGasLimit,
        feeAmount: gas,
      })
    })

    it('leaves the gas limit and fee unchanged when isIbcTransfer is explicitly false', () => {
      expect(resolveCosmosGasFee({ gas, relayedGasLimit: undefined, staticGasLimit, isIbcTransfer: false })).toEqual({
        resolvedGasLimit: staticGasLimit,
        feeAmount: gas,
      })
    })

    it('doubles the gas limit and fee for an IBC transfer with no relayed limit', () => {
      expect(resolveCosmosGasFee({ gas, relayedGasLimit: undefined, staticGasLimit, isIbcTransfer: true })).toEqual({
        resolvedGasLimit: staticGasLimit * 2n,
        feeAmount: gas * 2n,
      })
    })

    it('doubles the gas limit and fee for an IBC transfer with a zero relayed limit', () => {
      expect(resolveCosmosGasFee({ gas, relayedGasLimit: 0n, staticGasLimit, isIbcTransfer: true })).toEqual({
        resolvedGasLimit: staticGasLimit * 2n,
        feeAmount: gas * 2n,
      })
    })

    it('keeps the doubled fee when a relayed limit is below the IBC-adjusted static limit', () => {
      // staticGasLimit * 2 = 400_000; a 300_000 relayed limit stays below it
      expect(resolveCosmosGasFee({ gas, relayedGasLimit: 300_000n, staticGasLimit, isIbcTransfer: true })).toEqual({
        resolvedGasLimit: 300_000n,
        feeAmount: gas * 2n,
      })
    })

    it('scales further off the IBC-adjusted base when a relayed limit exceeds it', () => {
      // effective static = 400_000, effective gas = 15_000
      // 15_000 * 800_000 / 400_000 = 30_000
      expect(resolveCosmosGasFee({ gas, relayedGasLimit: 800_000n, staticGasLimit, isIbcTransfer: true })).toEqual({
        resolvedGasLimit: 800_000n,
        feeAmount: 30_000n,
      })
    })
  })
})
