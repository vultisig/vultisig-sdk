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

  it('re-exports XRPL issued-currency canonicals on the RN entrypoint', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')

    expect(typeof rn.toXrplCurrencyCode).toBe('function')
    expect(typeof rn.rippleTokenId).toBe('function')
    expect(typeof rn.parseRippleTokenId).toBe('function')
    expect(typeof rn.isValidXrplCurrencyCode).toBe('function')
    expect(typeof rn.parseIssuedCurrencyValue).toBe('function')
    expect(typeof rn.formatIssuedCurrencyValue).toBe('function')
    expect(rn.rippleIssuedCurrencyDecimals).toBe(15)
    expect(rn.rippleOwnerReserveDrops).toBe(200000n)
    expect(Array.isArray(rn.rippleKnownIssuedTokens)).toBe(true)
    expect(rn.toXrplCurrencyCode('RLUSD')).toBe('524C555344000000000000000000000000000000')
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

// Same parity guard for the hardened human-amount -> base-units parser: the RN
// allow-list entry re-exports it separately from the root barrel, so deleting
// the RN line leaves the app resolving `undefined` while publicExports.test.ts
// (node condition only) stays green.
describe('RN entry exposes toChainAmount + ChainAmountParseError', () => {
  it('resolves the parser and its error class from the RN entry, not just the root barrel', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')

    expect(typeof rn.toChainAmount).toBe('function')
    expect(rn.toChainAmount('1.2345e-3', 8)).toBe(123450n)

    expect(typeof rn.ChainAmountParseError).toBe('function')
    expect(() => rn.toChainAmount('   ', 8)).toThrow(rn.ChainAmountParseError)
  })

  it('exports the EVM chainId helpers from the RN entry', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')

    expect(typeof rn.getEvmChainId).toBe('function')
    expect(typeof rn.getEvmChainByChainId).toBe('function')
    expect(rn.getEvmChainId(rn.Chain.Ethereum)).toBe('0x1')
    expect(rn.getEvmChainByChainId('0x1')).toBe(rn.Chain.Ethereum)
  })
})
