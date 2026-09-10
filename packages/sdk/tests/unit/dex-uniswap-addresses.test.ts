import { Chain } from '@vultisig/core-chain/Chain'
import { getKnownToken } from '@vultisig/core-chain/coin/knownTokens/utils'
import { describe, expect, it } from 'vitest'

import { resolveNativeToken, supportedUniV3Chains, UNI_V3_FACTORY } from '@/tools/dex/uniswap/addresses'

describe('Uniswap V3 addresses', () => {
  it('lists Robinhood with the factory Uniswap publishes for chain 4663', () => {
    expect(supportedUniV3Chains()).toContain('Robinhood')
    expect(UNI_V3_FACTORY.Robinhood).toBe('0x1f7d7550B1b028f7571E69A784071F0205FD2EfA')
  })

  it('resolves native on Robinhood to the WETH already in the token catalog', () => {
    const wrapped = resolveNativeToken('native', 'Robinhood')
    const catalogEntry = getKnownToken({ chain: Chain.Robinhood, id: wrapped })

    expect(wrapped).toBe('0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73')
    expect(catalogEntry?.ticker).toBe('WETH')
  })

  it('keeps every wrapped-native chain inside the factory table', () => {
    for (const chain of supportedUniV3Chains()) {
      expect(resolveNativeToken('native', chain)).not.toBe('native')
    }
  })
})
