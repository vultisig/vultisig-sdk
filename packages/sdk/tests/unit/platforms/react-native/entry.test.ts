import * as customRpcOverrides from '@vultisig/core-chain/chains/customRpc/customRpcOverrides'
import * as customRpcSupportedChains from '@vultisig/core-chain/chains/customRpc/customRpcSupportedChains'
import { AuthInfo, SignDoc, TxBody } from 'cosmjs-types/cosmos/tx/v1beta1/tx'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import * as sdkRn from '../../../../src/platforms/react-native/index'
import { cosmosTxFeeGasParityCases } from '../../../fixtures/cosmosTxFeeGasParity'

process.env.VULTISIG_STRICT_SINGLETON = '0'

vi.mock('expo-crypto', () => ({
  randomUUID: () => '00000000-0000-4000-8000-000000000000',
  getRandomValues: <T extends ArrayBufferView | null>(a: T) => a,
}))

vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: async () => ({
    execAsync: async () => {},
    getAllAsync: async () => [],
    getFirstAsync: async () => null,
    runAsync: async () => ({}),
    withExclusiveTransactionAsync: async (
      task: (transaction: {
        execAsync: () => Promise<void>
        getAllAsync: () => Promise<never[]>
        getFirstAsync: () => Promise<null>
        runAsync: () => Promise<object>
      }) => Promise<void>
    ) => {
      await task({
        execAsync: async () => {},
        getAllAsync: async () => [],
        getFirstAsync: async () => null,
        runAsync: async () => ({}),
      })
    },
  }),
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

let reactNativeEntry: Awaited<typeof import('../../../../src/platforms/react-native/index')>
let dangerousAddresses: Awaited<typeof import('../../../../src/utils/dangerousAddresses')>

beforeAll(async () => {
  ;[reactNativeEntry, dangerousAddresses] = await Promise.all([
    import('../../../../src/platforms/react-native/index'),
    import('../../../../src/utils/dangerousAddresses'),
  ])
}, 120_000)

describe('RN entry wires configureCrypto and configureDefaultStorage', () => {
  it('exports canonical fast-vault detection helpers', async () => {
    const canonical = await import('@vultisig/core-mpc/devices/localPartyId')

    expect(reactNativeEntry.hasServer).toBe(canonical.hasServer)
    expect(reactNativeEntry.isServer).toBe(canonical.isServer)
    expect(reactNativeEntry.hasServer(['Android-current', 'VultiServer-legacy'])).toBe(true)
  })

  it.each([
    'EVM_DANGEROUS_ADDRESSES',
    'SOLANA_DANGEROUS_ADDRESSES',
    'UTXO_DANGEROUS_ADDRESSES',
    'XRP_DANGEROUS_ADDRESSES',
    'getEvmDangerousReason',
    'isEvmBurnAddress',
    'getChainDangerousReason',
    'assertSafeEvmDestination',
    'assertSafeDestination',
    'assertSafeTokenTransferDestination',
    'decodeErc20Approve',
    'decodeErc20Recipient',
    'decodeErc20RecipientFromSig',
    'ERC20_APPROVE_SELECTOR',
    'isErc20TransferCalldata',
  ] as const)('re-exports dangerous-address canonical %s by identity', async name => {
    expect(reactNativeEntry[name]).toBe(dangerousAddresses[name])
  })

  it('re-exports the plural StakeKit scan-request builder by identity', async () => {
    const stakekit = await import('../../../../src/tools/defi/stakekit')
    expect(reactNativeEntry.buildYieldActionScanRequests).toBe(stakekit.buildYieldActionScanRequests)
  })

  it.each([
    'chunkStakekitBalanceQueries',
    'fetchAllStakekitBalances',
    'fetchStakekitBalancesBatch',
    'STAKEKIT_BALANCE_QUERIES_PER_REQUEST',
  ] as const)('re-exports StakeKit batched-balances canonical %s by identity', async name => {
    const stakekit = await import('../../../../src/tools/defi/stakekit')
    expect(reactNativeEntry[name]).toBe(stakekit[name])
  })

  // sdk#1772: the RN entry omitted the whole validation / address-format
  // canonical family, so mobile consumers had to deep-import or keep an
  // app-local mirror - the exact duplicated-not-imported drift these helpers
  // were added to remove.
  //
  // This asserts the ENTIRE runtime surface of each canonical module is
  // re-exported, rather than a hand-listed set of names. A hand-listed set only
  // catches what someone remembered to list; walking the module catches a
  // helper ADDED to it later and wired only into the root entry, which is how
  // the gap opened in the first place.
  it.each([
    ['utils/validateNormalizers', () => import('../../../../src/utils/validateNormalizers')],
    ['utils/addressFormat', () => import('../../../../src/utils/addressFormat')],
    ['utils/addressValidation', () => import('../../../../src/utils/addressValidation')],
    ['utils/chainPrefix', () => import('../../../../src/utils/chainPrefix')],
    ['tools/policy', () => import('../../../../src/tools/policy')],
  ] as const)('re-exports every runtime export of %s on the RN entry, by identity', async (_name, load) => {
    const rn = (await import('../../../../src/platforms/react-native/index')) as Record<string, unknown>
    const mod = (await load()) as Record<string, unknown>

    const expected = Object.keys(mod).filter(k => k !== 'default')
    expect(expected.length).toBeGreaterThan(0)

    const missing = expected.filter(k => !(k in rn))
    expect(missing).toEqual([])

    // Identity, not just presence: a re-export that shadows the canonical with
    // a local reimplementation would satisfy `in rn` while still drifting.
    for (const key of expected) {
      expect(rn[key]).toBe(mod[key])
    }
  })

  // Root parity for the same family. The RN entry may legitimately omit
  // node-only surfaces, so this is deliberately scoped to these modules rather
  // than the whole root surface - a blanket root-vs-RN diff is 186 names today
  // and would be noise, not signal.
  it('matches the root entry for the validation / address-format family', async () => {
    const rn = (await import('../../../../src/platforms/react-native/index')) as Record<string, unknown>
    const root = (await import('../../../../src/index')) as Record<string, unknown>

    const family = [
      'amountMatches',
      'computeEvmFee',
      'decimalsFor',
      'feeMatches',
      'isValidTokenSymbolFormat',
      'normalizeTokenSymbol',
      'scaleHumanToRaw',
      'scaleRawToHuman',
      'tokenDecimals',
      'ValidateNormalizerError',
      'canonicalChainTag',
      'classifyAddress',
      'isAddressValidForChain',
      'isSolanaAddress',
      'supportedChainTags',
      'address',
      'validate',
      'checkChainPrefix',
      'policy',
      'checkInvariants',
      'evaluatePolicy',
    ]

    for (const key of family) {
      expect(root[key], `root entry lost ${key}`).toBeDefined()
      expect(rn[key], `RN entry is missing ${key}`).toBe(root[key])
    }
  })

  it('registers crypto + storage on module load so Vultisig({}) does not throw', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')
    const { randomUUID } = await import('../../../../src/crypto')
    const { getDefaultStorage } = await import('../../../../src/context/defaultStorage')

    expect(randomUUID()).toMatch(/^[0-9a-f-]{36}$/)
    const storage = getDefaultStorage()
    expect(storage).toBeDefined()
    expect(typeof storage.get).toBe('function')
    expect(rn.DEFAULT_CHAINS).toBe(rn.defaultChains)
  })

  it('re-exports root swap helpers needed by React Native consumers', () => {
    expect(typeof sdkRn.acrossQuote).toBe('function')
    expect(Array.isArray(sdkRn.acrossSupportedChains)).toBe(true)
    expect(typeof sdkRn.buildJupiterSwapTx).toBe('function')
    expect(typeof sdkRn.resolveJupiterFeeAccount).toBe('function')
    expect(typeof sdkRn.runSkipSwap).toBe('function')
    expect(typeof sdkRn.skipChainIdToChainName).toBe('function')
    expect(typeof sdkRn.findSwapQuote).toBe('function')
    expect(sdkRn.SOL_NATIVE_MINT).toBe('So11111111111111111111111111111111111111112')
    expect(sdkRn.JUPITER_PLATFORM_FEE_BPS).toBe(50)
  })

  it('exports default chain canonicals on the RN entrypoint', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')

    expect(Array.isArray(rn.DEFAULT_CHAINS)).toBe(true)
    expect(Array.isArray(rn.defaultChains)).toBe(true)
    expect(rn.DEFAULT_CHAINS).toEqual(['Bitcoin', 'Ethereum', 'THORChain', 'Solana', 'BSC'])
  })

  it('re-exports the RN-safe seedphrase helper family from the RN entrypoint without the eager discovery service', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')
    const types = await import('../../../../src/seedphrase/types')
    const language = await import('../../../../src/seedphrase/languageDetection')
    const validator = await import('../../../../src/seedphrase/SeedphraseValidator')
    const deriver = await import('../../../../src/seedphrase/MasterKeyDeriver')
    const constants = await import('../../../../src/constants')

    expect(rn.BIP39_LANGUAGES).toBe(types.BIP39_LANGUAGES)
    expect(rn.SEEDPHRASE_WORD_COUNTS).toBe(types.SEEDPHRASE_WORD_COUNTS)
    expect(rn.BIP39_WORDLISTS).toBe(language.BIP39_WORDLISTS)
    expect(rn.detectMnemonicLanguage).toBe(language.detectMnemonicLanguage)
    expect(rn.findInvalidWords).toBe(language.findInvalidWords)
    expect(rn.findInvalidWordsAcrossAllLanguages).toBe(language.findInvalidWordsAcrossAllLanguages)
    expect(rn.getWordlist).toBe(language.getWordlist)
    expect(rn.normalizeMnemonic).toBe(language.normalizeMnemonic)
    expect(rn.cleanMnemonic).toBe(validator.cleanMnemonic)
    expect(rn.SeedphraseValidator).toBe(validator.SeedphraseValidator)
    expect(rn.validateSeedphrase).toBe(validator.validateSeedphrase)
    expect(rn.MasterKeyDeriver).toBe(deriver.MasterKeyDeriver)
    expect(rn.cosmosPathTerra).toBe(deriver.cosmosPathTerra)
    expect(rn.assertSeedphraseImportSupportsChains).toBe(constants.assertSeedphraseImportSupportsChains)
    expect(rn.getUnsupportedSeedphraseImportChains).toBe(constants.getUnsupportedSeedphraseImportChains)
    expect(rn.isSeedphraseImportSupportedChain).toBe(constants.isSeedphraseImportSupportedChain)
    expect(rn.SEEDPHRASE_IMPORT_SUPPORTED_CHAINS).toBe(constants.SEEDPHRASE_IMPORT_SUPPORTED_CHAINS)
    expect(rn.SEEDPHRASE_IMPORT_UNSUPPORTED_CHAINS).toBe(constants.SEEDPHRASE_IMPORT_UNSUPPORTED_CHAINS)

    expect('ChainDiscoveryService' in rn).toBe(false)
    expect('TransportError' in rn).toBe(false)

    expect(rn.normalizeMnemonic('  ABANDON\nABANDON  ')).toBe('abandon abandon')
    expect(
      rn.detectMnemonicLanguage(
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      )
    ).toBe('english')
  })

  it('exports the canonical Cosmos fee helpers, gas-limit tables, and cosmos chain subsets from the RN entry', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')

    expect(rn.cosmosFeeCoinDenom[rn.Chain.Cosmos]).toBe('uatom')
    expect(rn.getCosmosAllowedFeeDenoms(rn.Chain.Cosmos)).toContain('uatom')
    expect(rn.isCosmosFeeDenomAllowed(rn.Chain.Cosmos, 'uatom')).toBe(true)
    expect(rn.isCosmosFeeDenomAllowed(rn.Chain.Cosmos, 'uusdc')).toBe(false)
    expect(rn.getCosmosGasLimit({ chain: rn.Chain.Cosmos })).toBe(200000n)
    expect(rn.getCosmosGasLimit({ chain: rn.Chain.MayaChain })).toBe(2_000_000_000n)
    expect(rn.getCosmosStakingGasLimit({ chain: rn.Chain.Cosmos })).toBe(350_000n)
    expect(rn.getCosmosStakingGasLimit({ chain: rn.Chain.Cosmos, msgCount: 2 })).toBe(437_500n)
    expect(rn.resolveChainReference('8453')).toBe(rn.Chain.Base)
    expect(rn.IbcEnabledCosmosChain.TerraClassic).toBe('TerraClassic')
    expect(rn.VaultBasedCosmosChain.THORChain).toBe('THORChain')
    expect(Object.values(rn.IbcEnabledCosmosChain)).not.toContain(rn.Chain.THORChain)
  })

  it.each(cosmosTxFeeGasParityCases)(
    'exports the canonical $chain fee denom, fee amount, and gas limit together',
    async ({ chain, feeDenom, feeAmount, gasLimit }) => {
      const rn = await import('../../../../src/platforms/react-native/index')

      expect(rn.getCosmosAllowedFeeDenoms(chain)[0]).toBe(feeDenom)
      expect(rn.getCosmosSendFeeBaseUnits(chain)).toBe(feeAmount)
      expect(rn.getCosmosGasLimit({ chain })).toBe(gasLimit)
    }
  )

  it('covers every Cosmos chain exposed by the RN entry', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')
    const exposedCosmosChains = Object.values(rn.Chain).filter(chain => rn.getChainKind(chain) === 'cosmos')

    expect(new Set(cosmosTxFeeGasParityCases.map(({ chain }) => chain))).toEqual(new Set(exposedCosmosChains))
  })

  it('exports the shared Cosmos send-fee constants used by the parity matrix', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')

    expect(rn.COSMOS_SEND_FEE_DEFAULT).toBe(7_500n)
    expect(rn.MAYA_SEND_FEE_BASE_UNITS).toBe(2_000_000_000n)
  })

  it('exports and encodes the TerraClassic staking gas/fee pair in a redelegation SignDoc', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')
    const gasLimit = rn.getCosmosStakingGasLimit({ chain: rn.Chain.TerraClassic })

    expect(gasLimit).toBe(4_000_000n)
    expect(rn.TERRA_CLASSIC_STAKING_ULUNA_FEE_BASE_UNITS).toBe(113_300_000n)

    const tx = rn.chains.cosmos.buildCosmosStakingTx({
      chainId: 'columbus-5',
      msgs: [
        {
          type: 'redelegate',
          delegatorAddress: 'terra1qyqszqgpqyqszqgpqyqszqgpqyqszqgp5hm70u',
          validatorSrcAddress: 'terravaloper1qgpqyqszqgpqyqszqgpqyqszqgpqyqsz9u3x5e',
          validatorDstAddress: 'terravaloper1qvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcryvs87c',
          amount: '1000000',
          denom: 'uluna',
        },
      ],
      sequence: 7,
      accountNumber: 42,
      pubKeyBytes: new Uint8Array(33).fill(0x02),
      gasLimit: Number(gasLimit),
      feeDenom: 'uluna',
      feeAmount: rn.TERRA_CLASSIC_STAKING_ULUNA_FEE_BASE_UNITS.toString(),
    })
    const signDoc = SignDoc.decode(tx.signDocBytes)
    const authInfo = AuthInfo.decode(signDoc.authInfoBytes)
    const txBody = TxBody.decode(signDoc.bodyBytes)

    expect(signDoc.chainId).toBe('columbus-5')
    expect(authInfo.fee?.gasLimit).toBe(gasLimit)
    expect(authInfo.fee?.amount).toEqual([
      { denom: 'uluna', amount: rn.TERRA_CLASSIC_STAKING_ULUNA_FEE_BASE_UNITS.toString() },
    ])
    expect(txBody.messages[0]?.typeUrl).toBe('/cosmos.staking.v1beta1.MsgBeginRedelegate')
  })

  it('keeps Robinhood derivation native-compatible on the exported RN surface', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')
    const deriveAddressFromPublicKey = vi.fn(() => '0x1234')
    const walletCore = {
      CoinType: { ethereum: 60, robinhoodChain: 10_004_663 },
      CoinTypeExt: { deriveAddressFromPublicKey },
    } as unknown as import('@vultisig/walletcore-native').WalletCoreLike
    const publicKey = { _handle: 7 }

    const coinType = rn.getCoinType({ chain: rn.Chain.Robinhood, walletCore })
    const robinhoodAddress = rn.deriveAddress({ chain: rn.Chain.Robinhood, publicKey, walletCore })
    const ethereumAddress = rn.deriveAddress({ chain: rn.Chain.Ethereum, publicKey, walletCore })

    expect(coinType).toBe(10_004_663)
    expect(Number.isInteger(coinType)).toBe(true)
    expect(robinhoodAddress).toBe(ethereumAddress)
    expect(deriveAddressFromPublicKey).toHaveBeenNthCalledWith(1, 10_004_663, publicKey)
    expect(deriveAddressFromPublicKey).toHaveBeenNthCalledWith(2, 60, publicKey)
  })

  it('exports isValidTokenId (WalletCoreLike) for non-address token families from the RN entry', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')
    // Sui and a malformed Ripple id never reach the walletCore-dependent
    // address-validation branch, so an empty stub is safe here.
    const walletCore = {} as import('@vultisig/walletcore-native').WalletCoreLike

    expect(typeof rn.isValidTokenId).toBe('function')
    expect(rn.isValidTokenId({ chain: rn.Chain.Sui, id: '0x2::sui::SUI', walletCore })).toBe(true)
    expect(rn.isValidTokenId({ chain: rn.Chain.Sui, id: 'not-a-struct-tag', walletCore })).toBe(false)
    expect(rn.isValidTokenId({ chain: rn.Chain.Ripple, id: 'not-a-composite-id', walletCore })).toBe(false)
  })

  it('exports the shared THORChain secured-asset catalog from the RN entry', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')

    expect(typeof rn.getThorchainSecuredAssetCatalog).toBe('function')
    expect(typeof rn.createThorchainSecuredAssetCatalog).toBe('function')
    expect(typeof rn.getThorchainSwapDestinationAssets).toBe('function')
    expect(rn.thorchainSecuredAssetFallback.length).toBeGreaterThan(10)
  })

  // sdk#1538 - the memo-cap family was already exported from the root SDK
  // entrypoint but omitted from the RN allow-list, pushing mobile consumers
  // toward local memo-cap tables. An over-long memo signs fine but gets
  // rejected (or silently truncated by an intermediary) at broadcast, so
  // drift here is a money/UX bug, not just a lint nit.
  it('exports the canonical Cosmos memo-cap helpers from the RN entry', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')

    expect(rn.COSMOS_MEMO_DEFAULT_MAX_BYTES).toBe(256)
    expect(rn.getCosmosMemoMaxBytes(rn.Chain.Cosmos)).toBe(512)
    expect(rn.getCosmosMemoMaxBytes(rn.Chain.Osmosis)).toBe(256)
    expect(rn.getCosmosMemoMaxBytesByChainId('phoenix-1')).toBe(512)
    expect(rn.isCosmosMemoWithinCap(rn.Chain.Osmosis, 'a'.repeat(256))).toBe(true)
    expect(rn.isCosmosMemoWithinCap(rn.Chain.Osmosis, 'a'.repeat(257))).toBe(false)
  })

  it('exports the canonical Cosmos custom-signing payload builders from the RN entry', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')
    const canonical = await import('../../../../src/vault/services/cosmos')

    expect(rn.buildSignAminoKeysignPayload).toBe(canonical.buildSignAminoKeysignPayload)
    expect(rn.buildSignDirectKeysignPayload).toBe(canonical.buildSignDirectKeysignPayload)
  })

  // sdk#1657 - buildSignAminoKeysignPayload/buildSignDirectKeysignPayload only
  // ever call `publicKey.data()`, but their exported `publicKey` type was
  // pinned to @trustwallet/wallet-core's `PublicKey`. RN consumers hold a
  // @vultisig/walletcore-native `NativePublicKeyInstance` instead, which is
  // not that class, so the RN-published type forced a cast. This test assigns
  // a `NativePublicKeyInstance`-typed value directly to `publicKey` with no
  // `as` — it fails to compile (not just fails at runtime) if the export ever
  // narrows back to the TrustWallet WASM type.
  it('accepts a React Native NativePublicKeyInstance as publicKey with no cast', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')

    const nativePublicKey: import('@vultisig/walletcore-native').NativePublicKeyInstance = {
      _handle: 1,
      data: () => new Uint8Array([1, 2, 3]),
      uncompressed() {
        return this
      },
      compressed() {
        return this
      },
      verify: () => true,
      verifyAsDER: () => true,
      delete: () => {},
    }

    const payload = await rn.buildSignAminoKeysignPayload({
      chain: rn.Chain.Cosmos,
      coin: {
        chain: rn.Chain.Cosmos,
        address: 'cosmos1abcdef',
        decimals: 6,
        ticker: 'ATOM',
      },
      msgs: [],
      fee: {
        amount: [{ denom: 'uatom', amount: '5000' }],
        gas: '200000',
      },
      vaultId: 'vault-ecdsa',
      localPartyId: 'device-1',
      publicKey: nativePublicKey,
      libType: 'DKLS',
      skipChainSpecificFetch: true,
    })

    expect(payload.coin?.hexPublicKey).toBe('010203')
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

  it('re-exports the root River helper family on the RN entrypoint', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')
    const river = await import('../../../../src/tools/defi/river')

    expect(rn.describeRiverMarket).toBe(river.describeRiverMarket)
    expect(rn.findRiverInsertHints).toBe(river.findRiverInsertHints)
    expect(rn.formatRiverPercentWad).toBe(river.formatRiverPercentWad)
    expect(rn.RIVER_TROVE_STATUS_NAMES).toBe(river.RIVER_TROVE_STATUS_NAMES)
    expect(rn.riverStatusName).toBe(river.riverStatusName)
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

  it('re-exports XRP destination/X-address normalization on the RN entrypoint', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')

    expect(typeof rn.decodeRippleXAddress).toBe('function')
    expect(typeof rn.encodeRippleXAddress).toBe('function')
    expect(typeof rn.isValidRippleXAddress).toBe('function')
    expect(typeof rn.normalizeRippleDestination).toBe('function')

    const classicAddress = 'raJ1Aqkhf19P7cyUc33MMVAzgvHPvtNFC'
    expect(rn.normalizeRippleDestination(classicAddress)).toEqual({ address: classicAddress })

    const xAddress = rn.encodeRippleXAddress(classicAddress, 42)
    expect(rn.isValidRippleXAddress(xAddress)).toBe(true)
    expect(rn.decodeRippleXAddress(xAddress)).toEqual({ address: classicAddress, destinationTag: 42 })
    expect(rn.normalizeRippleDestination(xAddress)).toEqual({ address: classicAddress, destinationTag: 42 })
  })

  it('re-exports the custom-RPC canonicals on the RN entrypoint', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')

    expect(rn.customRpcSupportedChains).toBe(customRpcSupportedChains.customRpcSupportedChains)
    expect(rn.customRpcSupportedEvmChains).toBe(customRpcSupportedChains.customRpcSupportedEvmChains)
    expect(rn.customRpcSupportedCosmosChains).toBe(customRpcSupportedChains.customRpcSupportedCosmosChains)
    expect(rn.isCustomRpcSupported).toBe(customRpcSupportedChains.isCustomRpcSupported)
    expect(rn.getCustomRpcOverride).toBe(customRpcOverrides.getCustomRpcOverride)
    expect(rn.setCustomRpcOverride).toBe(customRpcOverrides.setCustomRpcOverride)
    expect(rn.clearCustomRpcOverride).toBe(customRpcOverrides.clearCustomRpcOverride)
    expect(rn.setCustomRpcOverrides).toBe(customRpcOverrides.setCustomRpcOverrides)
    expect(rn.getCustomRpcOverrides).toBe(customRpcOverrides.getCustomRpcOverrides)
    expect(rn.probeRpcHealth).toBeTypeOf('function')

    rn.clearCustomRpcOverride(rn.Chain.Base)
    expect(rn.isCustomRpcSupported(rn.Chain.Base)).toBe(true)
    expect(rn.isCustomRpcSupported(rn.Chain.MayaChain)).toBe(false)
    rn.setCustomRpcOverride(rn.Chain.Base, ' https://base.example ')
    expect(rn.getCustomRpcOverride(rn.Chain.Base)).toBe('https://base.example')
    expect(rn.getCustomRpcOverrides()).toEqual({ [rn.Chain.Base]: 'https://base.example' })
    rn.clearCustomRpcOverride(rn.Chain.Base)
    expect(rn.getCustomRpcOverride(rn.Chain.Base)).toBeUndefined()
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

  it('exports the RN vault-backup helpers and constants from the RN entry', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')
    const rnEncrypt = await import('../../../../src/platforms/react-native/polyfills/encryptVaultBackupWithPassword')
    const rnDecrypt = await import('../../../../src/platforms/react-native/polyfills/decryptVaultBackupWithPassword')
    const constants = await import('@vultisig/lib-utils/encryption/vaultBackup/vaultBackupConstants')

    expect(rn.encryptVaultBackupWithPassword).toBe(rnEncrypt.encryptVaultBackupWithPassword)
    expect(rn.decryptVaultBackupWithPassword).toBe(rnDecrypt.decryptVaultBackupWithPassword)
    expect(rn.DEFAULT_VAULT_BACKUP_PBKDF2_ITERATIONS).toBe(constants.DEFAULT_VAULT_BACKUP_PBKDF2_ITERATIONS)
    expect(Buffer.from(rn.VAULT_BACKUP_BLOB_MAGIC)).toEqual(Buffer.from(constants.VAULT_BACKUP_BLOB_MAGIC))
    expect(rn.VAULT_BACKUP_SALT_LEN).toBe(constants.VAULT_BACKUP_SALT_LEN)
    expect(rn.VAULT_BACKUP_IV_LEN).toBe(constants.VAULT_BACKUP_IV_LEN)
    expect(rn.VAULT_BACKUP_MAGIC_LEN).toBe(constants.VAULT_BACKUP_MAGIC_LEN)
    expect(rn.VAULT_BACKUP_PBKDF2_HEADER_LEN).toBe(constants.VAULT_BACKUP_PBKDF2_HEADER_LEN)
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
describe('RN entry exposes pure chain helpers and registry', () => {
  it('resolves the helpers and registry from the RN entry, not just the root barrel', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')

    expect(typeof rn.fromChainAmountExact).toBe('function')
    expect(rn.fromChainAmountExact(123456789012345678901n, 18)).toBe('123.456789012345678901')

    expect(typeof rn.getBlockExplorerUrl).toBe('function')
    expect(rn.getBlockExplorerUrl({ chain: rn.Chain.Ethereum, entity: 'address', value: '0xabc' })).toBe(
      'https://etherscan.io/address/0xabc'
    )

    expect(Object.keys(rn.chainRegistry).sort()).toEqual(Object.values(rn.Chain).sort())
    expect(typeof rn.deriveFromChainRegistry).toBe('function')
    expect(typeof rn.extendChainRegistry).toBe('function')
    expect(rn.chainRegistry[rn.Chain.Ethereum].explorer.baseUrl).toBe('https://etherscan.io')
  })

  it('re-exports the recent pure parse/normalize/decode helpers from the RN entrypoint', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')
    const parse = await import('../../../../src/tools/parse')
    const tx = await import('../../../../src/tx')
    const decode = await import('../../../../src/tools/decode')
    const pairing = await import('../../../../src/services/buildKeygenPairingQrPayload')

    expect(rn.parseChain).toBe(parse.parseChain)
    expect(rn.parseTicker).toBe(parse.parseTicker)
    expect(rn.chainSchema).toBe(parse.chainSchema)
    expect(rn.tickerSchema).toBe(parse.tickerSchema)
    expect(rn.normalizeTx).toBe(tx.normalizeTx)
    expect(rn.splitMultiTx).toBe(tx.splitMultiTx)
    expect(rn.TxNormalizeError).toBe(tx.TxNormalizeError)
    expect(rn.parseTxReadyEnvelope).toBe(tx.parseTxReadyEnvelope)
    expect(rn.TxReadyParseError).toBe(tx.TxReadyParseError)
    expect(rn.decodeFromToolResult).toBe(decode.decodeFromToolResult)
    expect(rn.decodeCosmosTx).toBe(decode.decodeCosmosTx)
    expect(rn.decodeEvmTx).toBe(decode.decodeEvmTx)
    // sdk#1310: sdk.decode.fromToolResult is the documented canonical shape.
    expect(rn.decode.fromToolResult).toBe(decode.decodeFromToolResult)
    expect(rn.decode.decodeCosmosTx).toBe(decode.decodeCosmosTx)
    expect(rn.decode.decodeEvmTx).toBe(decode.decodeEvmTx)
    expect(rn.buildKeygenPairingQrPayload).toBe(pairing.buildKeygenPairingQrPayload)
  })

  it('re-exports canonical swap tracker URL helpers from the RN entrypoint', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')
    const swap = await import('@vultisig/core-chain/swap/utils/getSwapExplorerUrl')

    expect(rn.getSwapExplorerUrl).toBe(swap.getSwapExplorerUrl)
    expect(rn.swapExplorerProviders).toBe(swap.swapExplorerProviders)
    expect(
      rn.getSwapExplorerUrl({
        provider: 'li.fi',
        txHash: '0xabc',
        fromChain: rn.Chain.Base,
      })
    ).toBe('https://scan.li.fi/tx/0xabc')
  })

  it('re-exports Noon vault helpers from the RN entrypoint', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')
    const noon = await import('@vultisig/core-chain/chains/evm/noon')

    expect(rn.noonUsdcVaultConfig).toBe(noon.noonUsdcVaultConfig)
    expect(rn.getNoonDepositTxPlan).toBe(noon.getNoonDepositTxPlan)
    expect(rn.readNoonVaultState).toBe(noon.readNoonVaultState)
    expect(rn.fetchNoonUsdcVaultMetrics).toBe(noon.fetchNoonUsdcVaultMetrics)
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

  it('exports the EVM chainId helpers and priority-fee sanity clamp from the RN entry', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')

    expect(typeof rn.getEvmChainId).toBe('function')
    expect(typeof rn.getEvmNumericChainId).toBe('function')
    expect(typeof rn.getEvmChainByChainId).toBe('function')
    expect(typeof rn.clampEvmPriorityFee).toBe('function')
    expect(rn.getEvmChainId(rn.Chain.Ethereum)).toBe('0x1')
    expect(rn.getEvmNumericChainId(rn.Chain.Ethereum)).toBe(1)
    expect(rn.getEvmChainByChainId('0x1')).toBe(rn.Chain.Ethereum)
    expect(
      rn.clampEvmPriorityFee(rn.Chain.Base as Parameters<typeof rn.clampEvmPriorityFee>[0], 75n * 1_000_000_000n)
    ).toBe(50n * 1_000_000_000n)
  })

  it('exports the canonical gas comparison helpers from the RN entry', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')
    const gas = await import('../../../../src/tools/gas')

    expect(rn.compareCosts).toBe(gas.compareCosts)
    expect(rn.DEFAULT_COMPARE_CHAINS).toBe(gas.DEFAULT_COMPARE_CHAINS)
    expect(rn.GAS_UNITS).toBe(gas.GAS_UNITS)
    expect(rn.getChainGasPriceGwei).toBe(gas.getChainGasPriceGwei)
  })

  it('exports canonical chain-kind helpers from the RN entry', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')
    const chainKind = await import('@vultisig/core-chain/ChainKind')

    expect(rn.getChainKind).toBe(chainKind.getChainKind)
    expect(rn.isChainOfKind).toBe(chainKind.isChainOfKind)
    expect(rn.getChainKind(rn.Chain.Ethereum)).toBe('evm')
    expect(rn.isChainOfKind(rn.Chain.Solana, 'solana')).toBe(true)
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

  it('exports the swap-progress explorer helpers from the RN entry', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')

    expect(typeof rn.getSwapExplorerUrl).toBe('function')
    expect(Array.isArray(rn.swapExplorerProviders)).toBe(true)
    expect(rn.getSwapExplorerUrl({ provider: 'thorchain', txHash: '0xabc', fromChain: rn.Chain.THORChain })).toBe(
      'https://runescan.io/tx/abc'
    )
  })

  it('exports the canonical THOR/Maya native-swap metadata from the RN entry (sdk#1988)', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')
    const nativeSwapChain = await import('@vultisig/core-chain/swap/native/NativeSwapChain')

    expect(rn.nativeSwapChains).toBe(nativeSwapChain.nativeSwapChains)
    expect(rn.nativeSwapChainIds).toBe(nativeSwapChain.nativeSwapChainIds)
    expect(rn.nativeSwapEnabledChainsRecord).toBe(nativeSwapChain.nativeSwapEnabledChainsRecord)
    expect(rn.getNativeSwapChainId).toBe(nativeSwapChain.getNativeSwapChainId)
    expect(rn.getNativeSwapChainIdFromDenomPrefix).toBe(nativeSwapChain.getNativeSwapChainIdFromDenomPrefix)
  })

  it('exports the THORChain LP v2 helper family from the RN entry', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')
    const thorLp = await import('@vultisig/core-chain/chains/cosmos/thor/lp')
    const thorInbound = await import('@vultisig/core-chain/chains/cosmos/thor/getThorchainInboundAddress')

    expect(rn.getThorchainInboundAddress).toBe(thorInbound.getThorchainInboundAddress)
    expect(rn.buildThorchainLpAddPayload).toBe(thorLp.buildThorchainLpAddPayload)
    expect(rn.buildThorchainLpRemovePayload).toBe(thorLp.buildThorchainLpRemovePayload)
    expect(rn.getThorchainLpPosition).toBe(thorLp.getThorchainLpPosition)
    expect(rn.getThorchainLpPositions).toBe(thorLp.getThorchainLpPositions)
    expect(rn.getThorchainLpHaltStatus).toBe(thorLp.getThorchainLpHaltStatus)
    expect(rn.getThorchainLpLockupSeconds).toBe(thorLp.getThorchainLpLockupSeconds)
    expect(rn.resolvePairedAddressForLpAdd).toBe(thorLp.resolvePairedAddressForLpAdd)
    expect(rn.addLpMemo).toBe(thorLp.addLpMemo)
    expect(rn.removeLpMemo).toBe(thorLp.removeLpMemo)
  })
})

describe('RN entry exposes canonical EIP-712 helpers', () => {
  it('re-exports the same typed-data hash and signature canonicals as the node surface', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')
    const eip712 = await import('../../../../src/utils/eip712')

    expect(rn.coerceEip712ChainId).toBe(eip712.coerceEip712ChainId)
    expect(rn.computeEip712Hash).toBe(eip712.computeEip712Hash)
    expect(rn.toCanonicalEvmSignature).toBe(eip712.toCanonicalEvmSignature)
  })
})

describe('RN entry exposes canonical IBC + Sui prep helpers', () => {
  it('re-exports the canonical IBC + Sui prep helpers from the RN root surface', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')
    const prep = await import('../../../../src/tools/prep')
    const ibcTransfer = await import('../../../../src/tools/prep/ibcTransfer')
    const suiTokenTransfer = await import('../../../../src/tools/prep/suiTokenTransfer')

    expect(rn.prepareIbcTransfer).toBe(prep.prepareIbcTransfer)
    expect(rn.prepareIbcTransfer).toBe(ibcTransfer.prepareIbcTransfer)
    expect(rn.resolveSourceChannelByDestChain).toBe(prep.resolveSourceChannelByDestChain)
    expect(rn.resolveSourceChannelByDestChain).toBe(ibcTransfer.resolveSourceChannelByDestChain)
    expect(rn.resolveSourceChannelByDestChain('cosmoshub-4', 'noble-1')).toBe('channel-536')
    expect(rn.supportedIbcDestinationsFrom).toBe(prep.supportedIbcDestinationsFrom)
    expect(rn.normaliseIbcChainId).toBe(ibcTransfer.normaliseIbcChainId)
    expect(rn.IBC_MSG_TRANSFER_TYPE_URL).toBe(ibcTransfer.IBC_MSG_TRANSFER_TYPE_URL)
    expect(rn.IBC_CHAIN_HRP).toBe(ibcTransfer.IBC_CHAIN_HRP)
    expect(rn.IBC_CHAIN_REVISION).toBe(ibcTransfer.IBC_CHAIN_REVISION)
    expect(rn.IBC_CHANNEL_DEST).toBe(ibcTransfer.IBC_CHANNEL_DEST)

    expect(rn.prepareSuiTokenTransferFromKeys).toBe(prep.prepareSuiTokenTransferFromKeys)
    expect(rn.prepareSuiTokenTransferFromKeys).toBe(suiTokenTransfer.prepareSuiTokenTransferFromKeys)
    expect(rn.SUI_NATIVE_COIN_TYPE).toBe(suiTokenTransfer.SUI_NATIVE_COIN_TYPE)
  })
})
