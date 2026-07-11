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

  it('re-exports root-public pure helpers needed by React Native consumers', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')

    expect(typeof rn.parseChain).toBe('function')
    expect(rn.parseChain('cosmos')).toEqual({ success: true, chain: 'Cosmos' })

    expect(typeof rn.parseTicker).toBe('function')
    expect(rn.parseTicker('USDC')).toEqual({ success: true, ticker: 'USDC' })

    expect(typeof rn.isKnownContract).toBe('function')
    expect(rn.isKnownContract('0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')).toBe(true)
    expect(typeof rn.knownContracts.isKnownContract).toBe('function')
  })
})
