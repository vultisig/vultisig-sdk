import { describe, expect, it } from 'vitest'

import { IBC_GAS_MULTIPLIER, priceCosmosFeeForGasLimit, resolveCosmosGasFee } from './resolveCosmosGasFee.js'

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

  it('spends `gas` verbatim when the relayed limit exceeds the static limit', () => {
    // The initiator already priced `gas` for the relayed limit — re-scaling it
    // here would diverge from the Swift co-signers and break the signature.
    expect(resolveCosmosGasFee({ gas, relayedGasLimit: 400_000n, staticGasLimit })).toEqual({
      resolvedGasLimit: 400_000n,
      feeAmount: gas,
    })
  })

  it('spends `gas` verbatim for a limit that is not a multiple of the static one', () => {
    expect(resolveCosmosGasFee({ gas, relayedGasLimit: 300_001n, staticGasLimit })).toEqual({
      resolvedGasLimit: 300_001n,
      feeAmount: gas,
    })
  })

  it('matches the Swift reader on the Terra Classic send that broke co-signing', () => {
    // columbus-5: static 300k, simulate ≈ 320,687 -> the old scaling branch turned
    // a 20 LUNC fee into 21.379134 LUNC while iOS/macOS signed the 20 LUNC it was sent.
    expect(
      resolveCosmosGasFee({
        gas: 20_000_000n,
        relayedGasLimit: 320_687n,
        staticGasLimit: 300_000n,
      })
    ).toEqual({
      resolvedGasLimit: 320_687n,
      feeAmount: 20_000_000n,
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

    it('keeps the doubled fee when a relayed limit exceeds the IBC-adjusted static limit', () => {
      // effective gas = 15_000; the relayed limit only moves the gas limit, never the fee
      expect(resolveCosmosGasFee({ gas, relayedGasLimit: 800_000n, staticGasLimit, isIbcTransfer: true })).toEqual({
        resolvedGasLimit: 800_000n,
        feeAmount: gas * IBC_GAS_MULTIPLIER,
      })
    })
  })
})

describe('priceCosmosFeeForGasLimit', () => {
  const staticGasLimit = 200_000n
  const baseFee = 7500n

  it('returns the base fee unchanged at the static limit', () => {
    expect(priceCosmosFeeForGasLimit({ baseFee, gasLimit: staticGasLimit, staticGasLimit })).toBe(baseFee)
  })

  it('returns the base fee unchanged below the static limit', () => {
    expect(priceCosmosFeeForGasLimit({ baseFee, gasLimit: 100_000n, staticGasLimit })).toBe(baseFee)
  })

  it('scales proportionally above the static limit', () => {
    // 7500 * 400000 / 200000 = 15000 exactly
    expect(priceCosmosFeeForGasLimit({ baseFee, gasLimit: 400_000n, staticGasLimit })).toBe(15_000n)
  })

  it('rounds up so the ante handler is always cleared', () => {
    // 7500 * 300001 / 200000 = 11250.0375 -> ceil 11251
    expect(priceCosmosFeeForGasLimit({ baseFee, gasLimit: 300_001n, staticGasLimit })).toBe(11_251n)
  })

  it('prices the Terra Classic send the initiator relays', () => {
    expect(
      priceCosmosFeeForGasLimit({
        baseFee: 20_000_000n,
        gasLimit: 320_687n,
        staticGasLimit: 300_000n,
      })
    ).toBe(21_379_134n)
  })
})
