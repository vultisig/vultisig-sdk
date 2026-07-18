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

  it('exports the canonical prep constants from the RN entry', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')

    expect(rn.TRC20_TRANSFER_SELECTOR).toBe('transfer(address,uint256)')
    expect(rn.SUI_NATIVE_COIN_TYPE).toBe('0x2::sui::SUI')
    expect(rn.CONSOLIDATE_CHAINS).toEqual([
      rn.Chain.Bitcoin,
      rn.Chain.Litecoin,
      rn.Chain.Dogecoin,
      rn.Chain.BitcoinCash,
      rn.Chain.Dash,
    ])
  })

  it('exports the newer pure validation / normalization / policy helpers from the RN entry', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')
    const validateNormalizers = await import('../../../../src/utils/validateNormalizers')
    const addressFormat = await import('../../../../src/utils/addressFormat')
    const tx = await import('../../../../src/tx')
    const knownContracts = await import('../../../../src/utils/knownContracts')
    const policy = await import('../../../../src/tools/policy')

    expect(rn.amountMatches).toBe(validateNormalizers.amountMatches)
    expect(rn.classifyAddress).toBe(addressFormat.classifyAddress)
    expect(rn.normalizeTx).toBe(tx.normalizeTx)
    expect(rn.isKnownContract).toBe(knownContracts.isKnownContract)
    expect(rn.policy).toBe(policy.policy)

    expect(rn.classifyAddress('0x1234567890123456789012345678901234567890')).toBe('evm')
    expect(rn.scaleHumanToRaw('1.5', 6)).toBe(1500000n)
    expect(rn.isKnownContract('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')).toBe(true)
    expect(rn.checkChainPrefix('0x1234567890123456789012345678901234567890', 'Ethereum')).toMatchObject({
      valid: true,
      canonicalChain: 'ethereum',
    })
    expect(rn.policy.evaluate).toBe(policy.evaluatePolicy)
  })
})
