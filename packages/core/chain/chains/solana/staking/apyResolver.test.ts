import { describe, expect, it } from 'vitest'

import { onChainApy, resolveValidatorApy } from './apyResolver'
import { SolanaValidator } from './models/validator'

const validator = (overrides?: Partial<SolanaValidator>): SolanaValidator => ({
  votePubkey: 'V',
  nodePubkey: 'N',
  activatedStake: 1_000_000_000_000,
  commission: 5,
  epochVoteAccount: true,
  isDelinquent: false,
  metadata: {},
  ...overrides,
})

describe('resolveValidatorApy', () => {
  it('prefers the Stakewiz metadata estimate when present', () => {
    const apy = resolveValidatorApy({
      validator: validator({ metadata: { apyEstimate: 0.072 } }),
      inflationRate: 0.08,
      totalSupplyLamports: 2_000_000_000_000,
    })
    expect(apy).toBe(0.072)
  })

  it('falls back to the on-chain estimate when there is no metadata APY', () => {
    const apy = resolveValidatorApy({
      validator: validator(),
      inflationRate: 0.08,
      totalSupplyLamports: 2_000_000_000_000, // 50% staked
    })
    expect(apy).toBeGreaterThan(0)
  })

  it('returns undefined when neither source yields a value', () => {
    expect(
      resolveValidatorApy({
        validator: validator(),
        inflationRate: undefined,
        totalSupplyLamports: undefined,
      })
    ).toBeUndefined()
  })
})

describe('onChainApy', () => {
  const base = {
    inflationRate: 0.08,
    commission: 0,
    totalActivatedStake: 1_000_000_000_000,
    totalSupplyLamports: 2_000_000_000_000, // fraction staked = 0.5
  }

  it('compounds APR over the epochs-per-year into an APY', () => {
    // APR = (0.08 / 0.5) * (1 - 0) = 0.16; APY = (1 + 0.16/182)^182 - 1 > APR.
    const apy = onChainApy(base)
    expect(apy).toBeGreaterThan(0.16)
    expect(apy).toBeLessThan(0.2)
  })

  it('reduces the APY by the validator commission', () => {
    const noFee = onChainApy(base)
    const withFee = onChainApy({ ...base, commission: 50 })
    expect(withFee).toBeLessThan(noFee!)
  })

  it('returns undefined for missing / non-positive inputs', () => {
    expect(onChainApy({ ...base, inflationRate: undefined })).toBeUndefined()
    expect(onChainApy({ ...base, totalSupplyLamports: 0 })).toBeUndefined()
    expect(onChainApy({ ...base, totalActivatedStake: 0 })).toBeUndefined()
  })
})
