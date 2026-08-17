import { describe, expect, it, vi } from 'vitest'

process.env.VULTISIG_STRICT_SINGLETON = '0'

vi.mock('expo-crypto', () => ({
  randomUUID: () => '00000000-0000-4000-8000-000000000000',
  getRandomValues: <T extends ArrayBufferView | null>(a: T) => a,
}))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
    getAllKeys: async () => [],
    multiRemove: async () => {},
    clear: async () => {},
  },
}))
vi.mock('@vultisig/mpc-native', () => ({
  NativeMpcEngine: class {
    initialize = async () => {}
    dkls = {}
    schnorr = {}
  },
}))
vi.mock('@vultisig/walletcore-native', () => ({
  NativeWalletCore: { getInstance: async () => ({}) },
}))

// sdk#1957 / sdk#1988: the RN entry exported getEvmChainByChainId and
// getEvmChainId but not getEvmRpcUrl - so a mobile consumer could identify an
// EVM chain and then not reach its RPC endpoint, which is the one of the three
// you need to actually make a call. Same for the native-swap metadata.
describe('RN entry exports the EVM RPC + native-swap canonicals', () => {
  it.each(['getEvmChainByChainId', 'getEvmChainId', 'getEvmRpcUrl'] as const)(
    're-exports %s from the canonical evm chainInfo, by identity',
    async name => {
      const rn = (await import('../../../../src/platforms/react-native/index')) as Record<string, unknown>
      const chainInfo = (await import('@vultisig/core-chain/chains/evm/chainInfo')) as Record<string, unknown>

      expect(rn[name]).toBe(chainInfo[name])
    }
  )

  it.each([
    'nativeSwapChains',
    'nativeSwapEnabledChainsRecord',
    'nativeSwapChainIds',
    'getNativeSwapChainId',
    'getNativeSwapChainIdFromDenomPrefix',
  ] as const)('re-exports native-swap canonical %s by identity', async name => {
    const rn = (await import('../../../../src/platforms/react-native/index')) as Record<string, unknown>
    const canonical = (await import('@vultisig/core-chain/swap/native/NativeSwapChain')) as Record<string, unknown>

    expect(rn[name]).toBe(canonical[name])
  })
})
