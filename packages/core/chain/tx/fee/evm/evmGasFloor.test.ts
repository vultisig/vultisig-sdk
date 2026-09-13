import { EvmChain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { EVM_GAS_FLOOR_WEI, getEvmMaxFeeFloorWei } from './evmGasFloor'

const gwei = (n: number) => BigInt(Math.round(n * 1e9))

describe('EVM_GAS_FLOOR_WEI', () => {
  // Pins the values previously hand-copied between vultiagent-app's
  // MIN_PRIORITY_FEE_BY_CHAIN/MIN_MAX_FEE_BY_CHAIN and agent-backend-ts's
  // GAS_FLOORS_WEI, sourced from abts's copy (the more complete one — the
  // app's copy was missing an Ethereum entry, sdk#1351).
  it.each([
    [EvmChain.Sei, gwei(1.5), gwei(0.1)],
    [EvmChain.Hyperliquid, gwei(1), gwei(0.1)],
    [EvmChain.Arbitrum, gwei(0.1), gwei(0.01)],
    [EvmChain.Optimism, gwei(0.1), gwei(0.001)],
    [EvmChain.Base, gwei(0.1), gwei(0.001)],
    [EvmChain.Mantle, gwei(0.1), gwei(0.001)],
    [EvmChain.BSC, gwei(1), gwei(3)],
    [EvmChain.Polygon, gwei(1), gwei(30)],
    [EvmChain.Ethereum, gwei(1), gwei(1)],
  ])('pins the %s base/priority floor', (chain, basePerGas, priorityPerGas) => {
    expect(EVM_GAS_FLOOR_WEI[chain]).toEqual({ basePerGas, priorityPerGas })
  })

  it.each([EvmChain.Avalanche, EvmChain.CronosChain, EvmChain.Blast, EvmChain.Zksync, EvmChain.Robinhood])(
    'has no floor for %s (no documented evidence of a sub-floor rejection)',
    chain => {
      expect(EVM_GAS_FLOOR_WEI[chain]).toBeUndefined()
    }
  )
})

describe('getEvmMaxFeeFloorWei', () => {
  it('sums base + priority for a floored chain', () => {
    expect(getEvmMaxFeeFloorWei(EvmChain.BSC)).toBe(gwei(4)) // 1 + 3 gwei
    expect(getEvmMaxFeeFloorWei(EvmChain.Polygon)).toBe(gwei(31)) // 1 + 30 gwei
    expect(getEvmMaxFeeFloorWei(EvmChain.Ethereum)).toBe(gwei(2)) // 1 + 1 gwei
  })

  it('returns undefined for an unfloored chain', () => {
    expect(getEvmMaxFeeFloorWei(EvmChain.Avalanche)).toBeUndefined()
  })
})
