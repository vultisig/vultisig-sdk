import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { chainFeeCoin } from './chainFeeCoin'

describe('chainFeeCoin', () => {
  it('uses 8 decimals for QBTC to mirror Bitcoin', () => {
    // QBTC is designed to mirror BTC (1 QBTC = 100,000,000 base units).
    // The chain itself publishes no denom metadata, so this constant is the
    // single source of truth for balance display and amount parsing across
    // every Vultisig client. Regression guard for vultisig-windows#3910.
    expect(chainFeeCoin[Chain.QBTC].decimals).toBe(8)
    expect(chainFeeCoin[Chain.QBTC].decimals).toBe(
      chainFeeCoin[Chain.Bitcoin].decimals
    )
  })
})
