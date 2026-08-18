import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { getCosmosGasLimit, getCosmosStakingGasLimit } from './cosmosGasLimitRecord'

describe('cosmosGasLimitRecord', () => {
  it('keeps existing send gas limits unchanged', () => {
    expect(getCosmosGasLimit({ chain: Chain.Cosmos })).toBe(200_000n)
  })

  it('uses 300000 for every TerraClassic send denom to match iOS/Android SignDoc', () => {
    // The gas limit is part of the pre-sign image; iOS (TerraHelperStruct)
    // and Android (CosmosHelper.getChainGasLimit) hardcode 300000 for all
    // columbus-5 sends, so cross-device co-signing requires the same value
    // here regardless of denom (uluna, uusd, ...).
    expect(getCosmosGasLimit({ chain: Chain.TerraClassic, id: 'uluna' })).toBe(300_000n)
    expect(getCosmosGasLimit({ chain: Chain.TerraClassic, id: 'uusd' })).toBe(300_000n)
  })

  it('returns higher staking gas limits and scales bulk reward claim messages', () => {
    expect(getCosmosStakingGasLimit({ chain: Chain.Terra })).toBe(500_000n)
    // Terra (not TerraClassic) scales normally: 500k + ((3-1)*500k)/4 = 750k
    expect(getCosmosStakingGasLimit({ chain: Chain.Terra, msgCount: 3 })).toBe(750_000n)
    expect(getCosmosStakingGasLimit({ chain: Chain.TerraClassic })).toBe(4_000_000n)
  })

  it('TerraClassic: keeps the 4M single-transaction budget regardless of message count', () => {
    // The 4M budget covers the observed 2_501_503-gas redelegation path with
    // headroom. Multi-validator reward claims remain a caller-side split policy.
    expect(getCosmosStakingGasLimit({ chain: Chain.TerraClassic, msgCount: 1 })).toBe(4_000_000n)
    expect(getCosmosStakingGasLimit({ chain: Chain.TerraClassic, msgCount: 2 })).toBe(4_000_000n)
    expect(getCosmosStakingGasLimit({ chain: Chain.TerraClassic, msgCount: 3 })).toBe(4_000_000n)
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
