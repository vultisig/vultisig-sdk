import { Chain } from '@vultisig/core-chain/Chain'
import { cowSwapSupportedChains } from '@vultisig/core-chain/swap/general/cowswap/config'
import { jupiterSwapEnabledChains } from '@vultisig/core-chain/swap/general/jupiter/JupiterSwapEnabledChains'
import { kyberSwapEnabledChains } from '@vultisig/core-chain/swap/general/kyber/chains'
import { lifiSwapEnabledChains } from '@vultisig/core-chain/swap/general/lifi/LifiSwapEnabledChains'
import { oneInchSwapEnabledChains } from '@vultisig/core-chain/swap/general/oneInch/OneInchSwapEnabledChains'
import { swapKitEnabledChains } from '@vultisig/core-chain/swap/general/swapkit/SwapKitEnabledChains'
import { nativeSwapEnabledChains } from '@vultisig/core-chain/swap/native/NativeSwapChain'
import { describe, expect, it } from 'vitest'

import { swapEnabledChains } from './swapEnabledChains'

const providerChainLists = [
  nativeSwapEnabledChains,
  cowSwapSupportedChains,
  kyberSwapEnabledChains,
  oneInchSwapEnabledChains,
  jupiterSwapEnabledChains,
  lifiSwapEnabledChains,
  swapKitEnabledChains,
] as const

describe('swapEnabledChains', () => {
  it('includes every provider-specific enabled-chain registry', () => {
    const enabled = new Set(swapEnabledChains)

    for (const providerChains of providerChainLists) {
      for (const chain of providerChains) {
        expect(enabled.has(chain)).toBe(true)
      }
    }
  })

  it('does not advertise Kyber chains whose API path is not live', () => {
    expect(kyberSwapEnabledChains).not.toContain(Chain.Zksync)
    expect(kyberSwapEnabledChains).not.toContain(Chain.Blast)
  })
})
