import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { getCosmosGasLimit, getCosmosStakingGasLimit } from './cosmosGasLimitRecord'

describe('cosmosGasLimitRecord', () => {
  it('keeps existing send gas limits unchanged', () => {
    expect(getCosmosGasLimit({ chain: Chain.Cosmos })).toBe(200_000n)
    expect(getCosmosGasLimit({ chain: Chain.TerraClassic, id: 'uusd' })).toBe(1_000_000n)
  })

  it('returns higher staking gas limits and scales bulk reward claim messages', () => {
    expect(getCosmosStakingGasLimit({ chain: Chain.Terra })).toBe(500_000n)
    expect(getCosmosStakingGasLimit({ chain: Chain.TerraClassic })).toBe(2_000_000n)
    expect(getCosmosStakingGasLimit({ chain: Chain.TerraClassic, msgCount: 3 })).toBe(3_000_000n)
  })

  it('rejects invalid staking message counts before BigInt conversion', () => {
    expect(() => getCosmosStakingGasLimit({ chain: Chain.Terra, msgCount: 1.5 })).toThrow(
      'msgCount must be a non-negative integer'
    )
    expect(() => getCosmosStakingGasLimit({ chain: Chain.Terra, msgCount: -1 })).toThrow(
      'msgCount must be a non-negative integer'
    )
  })
})
