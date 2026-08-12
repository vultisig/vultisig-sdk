import { describe, expect, it, vi } from 'vitest'

import { cosmosTxFeeGasParityCases } from '../../../fixtures/cosmosTxFeeGasParity'

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

describe('RN entry wires configureCrypto and configureDefaultStorage', () => {
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
  ] as const)('re-exports dangerous-address canonical %s by identity', async name => {
    const rn = await import('../../../../src/platforms/react-native/index')
    const dangerousAddresses = await import('../../../../src/utils/dangerousAddresses')

    expect(rn[name]).toBe(dangerousAddresses[name])
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

  it('exports default chain canonicals on the RN entrypoint', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')

    expect(Array.isArray(rn.DEFAULT_CHAINS)).toBe(true)
    expect(Array.isArray(rn.defaultChains)).toBe(true)
    expect(rn.DEFAULT_CHAINS).toEqual(['Bitcoin', 'Ethereum', 'THORChain', 'Solana', 'BSC'])
  })

  it('exports the canonical Cosmos fee helpers and gas-limit tables from the RN entry', async () => {
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
    expect(typeof rn.getEvmChainByChainId).toBe('function')
    expect(typeof rn.clampEvmPriorityFee).toBe('function')
    expect(rn.getEvmChainId(rn.Chain.Ethereum)).toBe('0x1')
    expect(rn.getEvmChainByChainId('0x1')).toBe(rn.Chain.Ethereum)
    expect(
      rn.clampEvmPriorityFee(rn.Chain.Base as Parameters<typeof rn.clampEvmPriorityFee>[0], 75n * 1_000_000_000n)
    ).toBe(50n * 1_000_000_000n)
  })

  it('exports the EVM priority-fee floor/ceiling tables from the RN entry (vultisig-sdk#1157)', async () => {
    const rn = await import('../../../../src/platforms/react-native/index')

    expect(rn.evmPriorityFeeCeilingWeiByChain[rn.Chain.Ethereum]).toBe(500n * 1_000_000_000n)
    expect(rn.evmPriorityFeeFloorWeiByChain[rn.Chain.Polygon]).toBe(30n * 1_000_000_000n)
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
