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
    // Terra (not TerraClassic) scales normally: 500k + ((3-1)*500k)/4 = 750k
    expect(getCosmosStakingGasLimit({ chain: Chain.Terra, msgCount: 3 })).toBe(750_000n)
    expect(getCosmosStakingGasLimit({ chain: Chain.TerraClassic })).toBe(3_000_000n)
  })

  it('TerraClassic: msgCount scaling capped at base regardless of count (fee-floor constraint)', () => {
    // Columbus-5 fee floor: 100 LUNC = 100_000_000 uluna. At msgCount>=2 the
    // scaled gasWanted * gasPrice exceeds 100 LUNC, causing node rejection.
    // Single-msg policy: always return base=3M for TerraClassic.
    expect(getCosmosStakingGasLimit({ chain: Chain.TerraClassic, msgCount: 1 })).toBe(3_000_000n)
    expect(getCosmosStakingGasLimit({ chain: Chain.TerraClassic, msgCount: 2 })).toBe(3_000_000n)
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
