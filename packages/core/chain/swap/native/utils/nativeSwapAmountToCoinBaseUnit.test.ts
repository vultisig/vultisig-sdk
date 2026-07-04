import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { nativeSwapAmountToCoinBaseUnit } from './nativeSwapAmountToCoinBaseUnit'

describe('nativeSwapAmountToCoinBaseUnit', () => {
  it('rebases native-swap protocol output into the destination coin base units', () => {
    expect(
      nativeSwapAmountToCoinBaseUnit(54_992n, {
        chain: Chain.Ethereum,
        decimals: 18,
      })
    ).toBe(549_920_000_000_000n)

    expect(
      nativeSwapAmountToCoinBaseUnit(89_096_500n, {
        chain: Chain.Ethereum,
        id: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        decimals: 6,
      })
    ).toBe(890_965n)

    expect(
      nativeSwapAmountToCoinBaseUnit(153_853_140_240n, {
        chain: Chain.MayaChain,
        decimals: 10,
      })
    ).toBe(153_853_140_240n)
  })
})
