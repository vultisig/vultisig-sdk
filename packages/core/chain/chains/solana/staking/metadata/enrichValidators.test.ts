import { describe, expect, it } from 'vitest'

import { SolanaValidator } from '../models/validator'
import { enrichValidatorsWithMetadata } from './enrichValidators'
import { ValidatorMetadataProvider } from './ValidatorMetadataProvider'

const validator = (votePubkey: string): SolanaValidator => ({
  votePubkey,
  nodePubkey: 'node',
  activatedStake: 0,
  commission: 0,
  epochVoteAccount: true,
  isDelinquent: false,
  metadata: {},
})

const provider = (map: Awaited<ReturnType<ValidatorMetadataProvider['metadata']>>): ValidatorMetadataProvider => ({
  metadata: async () => map,
})

describe('enrichValidatorsWithMetadata', () => {
  it('merges provider metadata onto matching validators only', async () => {
    const [a, b] = await enrichValidatorsWithMetadata(
      [validator('V1'), validator('V2')],
      provider({ V1: { name: 'Alice', apyEstimate: 0.07 } })
    )
    expect(a.metadata).toEqual({ name: 'Alice', apyEstimate: 0.07 })
    expect(b.metadata).toEqual({})
  })

  it('passes validators through unchanged when the provider returns nothing', async () => {
    const [a] = await enrichValidatorsWithMetadata([validator('V1')], provider({}))
    expect(a.metadata).toEqual({})
  })
})
