import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { getNativeSwapChainId, nativeSwapChainIds } from './NativeSwapChain'

describe('getNativeSwapChainId', () => {
  it('returns the canonical native-swap chain id for enabled chains', () => {
    for (const [chain, chainId] of Object.entries(nativeSwapChainIds)) {
      expect(getNativeSwapChainId(chain as Chain)).toBe(chainId)
    }
  })

  it('returns null for unsupported chains', () => {
    expect(getNativeSwapChainId(Chain.Polkadot)).toBeNull()
  })
})
