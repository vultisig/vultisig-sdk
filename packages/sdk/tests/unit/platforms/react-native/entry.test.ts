import { describe, expect, it, vi } from 'vitest'

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

describe('RN entry wires configureCrypto and configureDefaultStorage', () => {
  it('registers crypto + storage on module load so Vultisig({}) does not throw', async () => {
    await import('../../../../src/platforms/react-native/index')
    const { randomUUID } = await import('../../../../src/crypto')
    const { getDefaultStorage } = await import('../../../../src/context/defaultStorage')

    expect(randomUUID()).toMatch(/^[0-9a-f-]{36}$/)
    const storage = getDefaultStorage()
    expect(storage).toBeDefined()
    expect(typeof storage.get).toBe('function')
  })

  it('exports the canonical Cosmos fee-denom helpers from the RN entry', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')

    expect(rn.getCosmosAllowedFeeDenoms(rn.Chain.Cosmos)).toContain('uatom')
    expect(rn.isCosmosFeeDenomAllowed(rn.Chain.Cosmos, 'uatom')).toBe(true)
    expect(rn.isCosmosFeeDenomAllowed(rn.Chain.Cosmos, 'uusdc')).toBe(false)
  })
})

// RN-entry parity guard: the root barrel (packages/sdk/src/index.ts, resolved
// via the node condition) is a wildcard-ish re-export surface, but this RN
// entry is a hand-curated allow-list — adding something to the root does NOT
// make it reachable from the app (Metro resolves the react-native condition
// to this file, never the node one). publicExports.test.ts only resolves the
// node condition and can't see a gap here; this test resolves the RN entry
// FILE directly so an omission fails loudly instead of shipping unreachable
// in the app. This partially addresses the recurring sdk#1224 allow-list-gap
// class (see e.g. the cosmosStaking / preparePolkadotAssetSend comments above
// in the source file) — it does not prevent future gaps, just catches this one.
describe('RN entry exposes fromChainAmountExact + getBlockExplorerUrl', () => {
  it('resolves both as functions from the RN entry, not just the root barrel', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')

    expect(typeof rn.fromChainAmountExact).toBe('function')
    expect(rn.fromChainAmountExact(123456789012345678901n, 18)).toBe('123.456789012345678901')

    expect(typeof rn.getBlockExplorerUrl).toBe('function')
    expect(rn.getBlockExplorerUrl({ chain: rn.Chain.Ethereum, entity: 'address', value: '0xabc' })).toBe(
      'https://etherscan.io/address/0xabc'
    )
  })
})
