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
    expect(rn.resolveChainReference('8453')).toBe(rn.Chain.Base)
  })

  it('exports the generic CosmWasm execute message builder from the RN root surface', async () => {
    const sdk = await import('../../../../src/platforms/react-native/index')

    expect(typeof sdk.buildCosmosWasmExecuteMsg).toBe('function')
    expect(
      sdk.buildCosmosWasmExecuteMsg({
        sender: 'thor1sender',
        contract: 'thor1contract',
        msg: { swap: { minimum_output: '123' } },
      })
    ).toEqual({
      type: 'wasm/MsgExecuteContract',
      value: '{"sender":"thor1sender","contract":"thor1contract","msg":{"swap":{"minimum_output":"123"}},"funds":[]}',
    })
  })

  it('re-exports the canonical IBC + Sui prep helpers from the RN root surface', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')
    const prep = await import('../../../../src/tools/prep')
    const ibcTransfer = await import('../../../../src/tools/prep/ibcTransfer')
    const suiTokenTransfer = await import('../../../../src/tools/prep/suiTokenTransfer')

    expect(rn.prepareIbcTransfer).toBe(prep.prepareIbcTransfer)
    expect(rn.prepareIbcTransfer).toBe(ibcTransfer.prepareIbcTransfer)
    expect(rn.supportedIbcDestinationsFrom).toBe(prep.supportedIbcDestinationsFrom)
    expect(rn.normaliseIbcChainId).toBe(ibcTransfer.normaliseIbcChainId)
    expect(rn.IBC_MSG_TRANSFER_TYPE_URL).toBe(ibcTransfer.IBC_MSG_TRANSFER_TYPE_URL)

    expect(rn.prepareSuiTokenTransferFromKeys).toBe(prep.prepareSuiTokenTransferFromKeys)
    expect(rn.prepareSuiTokenTransferFromKeys).toBe(suiTokenTransfer.prepareSuiTokenTransferFromKeys)
    expect(rn.SUI_NATIVE_COIN_TYPE).toBe(suiTokenTransfer.SUI_NATIVE_COIN_TYPE)
  })
})
