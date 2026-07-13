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

  it('re-exports the recent pure parse/normalize/decode helpers from the RN entrypoint', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')
    const parse = await import('../../../../src/tools/parse')
    const tx = await import('../../../../src/tx')
    const decode = await import('../../../../src/tools/decode')

    expect(rn.parseChain).toBe(parse.parseChain)
    expect(rn.parseTicker).toBe(parse.parseTicker)
    expect(rn.chainSchema).toBe(parse.chainSchema)
    expect(rn.tickerSchema).toBe(parse.tickerSchema)
    expect(rn.normalizeTx).toBe(tx.normalizeTx)
    expect(rn.splitMultiTx).toBe(tx.splitMultiTx)
    expect(rn.TxNormalizeError).toBe(tx.TxNormalizeError)
    expect(rn.decodeFromToolResult).toBe(decode.decodeFromToolResult)
    expect(rn.decodeCosmosTx).toBe(decode.decodeCosmosTx)
    expect(rn.decodeEvmTx).toBe(decode.decodeEvmTx)
  })
})
