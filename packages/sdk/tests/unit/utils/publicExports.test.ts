import * as customRpcOverrides from '@vultisig/core-chain/chains/customRpc/customRpcOverrides'
import * as customRpcSupportedChains from '@vultisig/core-chain/chains/customRpc/customRpcSupportedChains'
import * as isValidTokenIdModule from '@vultisig/core-chain/utils/isValidTokenId'
import { describe, expect, it } from 'vitest'

import * as sdk from '../../../src/index'
import * as dangerousAddresses from '../../../src/utils/dangerousAddresses'
import {
  buildSignAminoKeysignPayload as canonicalBuildSignAminoKeysignPayload,
  buildSignDirectKeysignPayload as canonicalBuildSignDirectKeysignPayload,
} from '../../../src/vault/services/cosmos'
import { cosmosTxFeeGasParityCases } from '../../fixtures/cosmosTxFeeGasParity'

const dangerousAddressCanonicalExports = [
  'EVM_DANGEROUS_ADDRESSES',
  'SOLANA_DANGEROUS_ADDRESSES',
  'UTXO_DANGEROUS_ADDRESSES',
  'XRP_DANGEROUS_ADDRESSES',
  'getEvmDangerousReason',
  'isEvmBurnAddress',
  'getChainDangerousReason',
  'assertSafeEvmDestination',
  'assertSafeDestination',
] as const

describe('@vultisig/sdk public exports', () => {
  it.each(dangerousAddressCanonicalExports)('re-exports dangerous-address canonical %s by identity', name => {
    expect(sdk[name]).toBe(dangerousAddresses[name])
  })

  it('exports fiatToAmount, toChainAmount, and chain-reference normalization utilities', () => {
    expect(typeof sdk.fiatToAmount).toBe('function')
    expect(typeof sdk.toChainAmount).toBe('function')
    expect(typeof sdk.normalizeChain).toBe('function')
    expect(typeof sdk.resolveChainReference).toBe('function')
    expect(typeof sdk.FiatToAmountError).toBe('function')
    expect(typeof sdk.ChainAmountParseError).toBe('function')
    expect(typeof sdk.UnknownChainError).toBe('function')
  })

  it('exports canonical EIP-712 helpers for first-party consumers', () => {
    expect(typeof sdk.coerceEip712ChainId).toBe('function')
    expect(typeof sdk.computeEip712Hash).toBe('function')
    expect(typeof sdk.toCanonicalEvmSignature).toBe('function')
    expect(sdk.coerceEip712ChainId('0x89')).toBe(137)
  })

  it('exports the hardened toChainAmount helper and error class with scientific-notation support', () => {
    expect(sdk.toChainAmount('1.2345e-3', 8)).toBe(123450n)

    expect(() => sdk.toChainAmount('   ', 8)).toThrow(sdk.ChainAmountParseError)
    expect(sdk.ChainAmountParseError.prototype).toBeInstanceOf(Error)
  })

  it('exports fromChainAmountExact, getBlockExplorerUrl, and the chain registry', () => {
    expect(typeof sdk.fromChainAmountExact).toBe('function')
    expect(sdk.fromChainAmountExact(123456789012345678901n, 18)).toBe('123.456789012345678901')

    expect(typeof sdk.getBlockExplorerUrl).toBe('function')
    expect(sdk.getBlockExplorerUrl({ chain: sdk.Chain.Ethereum, entity: 'address', value: '0xabc' })).toBe(
      'https://etherscan.io/address/0xabc'
    )

    expect(Object.keys(sdk.chainRegistry).sort()).toEqual(Object.values(sdk.Chain).sort())
    expect(typeof sdk.deriveFromChainRegistry).toBe('function')
    expect(typeof sdk.extendChainRegistry).toBe('function')
  })

  it('exports tx-shape normalization primitives (normalizeTx, splitMultiTx)', () => {
    expect(typeof sdk.normalizeTx).toBe('function')
    expect(typeof sdk.splitMultiTx).toBe('function')
    expect(typeof sdk.TxNormalizeError).toBe('function')
  })

  it('exports the knownContracts canonical registry + lookup helpers', () => {
    expect(typeof sdk.isKnownContract).toBe('function')
    expect(typeof sdk.isCanonicalEvmContract).toBe('function')
    expect(typeof sdk.isCanonicalSolanaAddress).toBe('function')
    expect(typeof sdk.isCanonicalTronContract).toBe('function')
    expect(sdk.canonicalEvmContracts instanceof Set).toBe(true)
    expect(typeof sdk.knownContracts.isKnownContract).toBe('function')
  })

  it('exports findSwapQuote, abiEncode, evmCheckAllowance (already consumed by mcp-ts)', () => {
    expect(typeof sdk.findSwapQuote).toBe('function')
    expect(typeof sdk.abiEncode).toBe('function')
    expect(typeof sdk.evmCheckAllowance).toBe('function')
  })

  it('exports the direct-checkout USDC router calldata + version/memo guards', () => {
    expect(sdk.AGENT_ROUTER_ADDRESS).toBe('0xFEEEeeEE643d6AD9eBC6B2025a03eB2290A72bBf')
    expect(sdk.ROUTER_VERSION_PINNED).toBe(1)
    expect(typeof sdk.buildApproveCalldata).toBe('function')
    expect(typeof sdk.buildDepositWithMemoCalldata).toBe('function')
    expect(typeof sdk.decodeApproveCalldata).toBe('function')
    expect(typeof sdk.decodeDepositWithMemoCalldata).toBe('function')
    expect(typeof sdk.assertCheckoutRouterVersion).toBe('function')
    expect(typeof sdk.isValidDepositMemo).toBe('function')
  })

  it('exports provider-aware swap arrival status normalization', () => {
    expect(typeof sdk.getSwapArrivalStatus).toBe('function')
    expect(typeof sdk.Vultisig.getSwapArrivalStatus).toBe('function')
    expect(typeof sdk.isSwapArrivalStatusTerminal).toBe('function')
    expect(typeof sdk.SwapArrivalStatusRequestError).toBe('function')
    expect(sdk.swapArrivalProviders).toEqual(['thorchain', 'mayachain', 'skip', 'li.fi'])
  })

  it('exports encodeErc20Approve, encodeErc20Revoke, MAX_UINT256 (ERC-20 approve/revoke calldata)', () => {
    expect(typeof sdk.encodeErc20Approve).toBe('function')
    expect(typeof sdk.encodeErc20Revoke).toBe('function')
    expect(sdk.MAX_UINT256).toBe((1n << 256n) - 1n)
  })

  it('exports buildJupiterSwapTx + Jupiter affiliate config (Solana swap leg for mcp-ts/backend)', () => {
    expect(typeof sdk.buildJupiterSwapTx).toBe('function')
    expect(typeof sdk.resolveJupiterFeeAccount).toBe('function')
    expect(sdk.SOL_NATIVE_MINT).toBe('So11111111111111111111111111111111111111112')
    expect(sdk.JUPITER_PLATFORM_FEE_BPS).toBe(50)
    // SOL-03: standardized on the shared cross-platform spec address
    // (jupiterFeeOwnerAddress), not the earlier ad-hoc '5QXePTia...' literal.
    expect(sdk.JUPITER_AFFILIATE_FEE_OWNER).toBe('8iqhrtBzMcYLR6c6FkzeoMHibedYDkHvLKnX2ArNie5z')
  })

  it('exports XRPL issued-currency canonicals from the root SDK entrypoint', () => {
    expect(typeof sdk.toXrplCurrencyCode).toBe('function')
    expect(typeof sdk.rippleTokenId).toBe('function')
    expect(typeof sdk.parseRippleTokenId).toBe('function')
    expect(typeof sdk.isValidXrplCurrencyCode).toBe('function')
    expect(typeof sdk.parseIssuedCurrencyValue).toBe('function')
    expect(typeof sdk.formatIssuedCurrencyValue).toBe('function')
    expect(sdk.rippleIssuedCurrencyDecimals).toBe(15)
    expect(sdk.rippleOwnerReserveDrops).toBe(200000n)
    // Identity pin, not just a shape check: an XRPL `USD`/`RLUSD` is only unique
    // per ISSUER, so a substituted (or dropped) issuer would silently publish a
    // worthless lookalike token carrying the real ticker, logo and price feed.
    // `Array.isArray(...)` alone stays green through both mutations.
    expect(sdk.rippleKnownIssuedTokens.map(token => token.id)).toEqual([
      '524C555344000000000000000000000000000000.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De',
    ])
    expect(sdk.rippleTokenId({ currency: 'RLUSD', issuer: 'rIssuer' })).toBe(
      '524C555344000000000000000000000000000000.rIssuer'
    )
    expect(sdk.parseRippleTokenId('524C555344000000000000000000000000000000.rIssuer')).toEqual({
      currency: '524C555344000000000000000000000000000000',
      issuer: 'rIssuer',
    })
  })

  it('exports the custom-RPC registry + health-probe canonicals from the root SDK entrypoint', () => {
    expect(sdk.customRpcSupportedChains).toBe(customRpcSupportedChains.customRpcSupportedChains)
    expect(sdk.customRpcSupportedEvmChains).toBe(customRpcSupportedChains.customRpcSupportedEvmChains)
    expect(sdk.customRpcSupportedCosmosChains).toBe(customRpcSupportedChains.customRpcSupportedCosmosChains)
    expect(sdk.isCustomRpcSupported).toBe(customRpcSupportedChains.isCustomRpcSupported)
    expect(sdk.getCustomRpcOverride).toBe(customRpcOverrides.getCustomRpcOverride)
    expect(sdk.setCustomRpcOverride).toBe(customRpcOverrides.setCustomRpcOverride)
    expect(sdk.clearCustomRpcOverride).toBe(customRpcOverrides.clearCustomRpcOverride)
    expect(sdk.setCustomRpcOverrides).toBe(customRpcOverrides.setCustomRpcOverrides)
    expect(sdk.getCustomRpcOverrides).toBe(customRpcOverrides.getCustomRpcOverrides)
    expect(sdk.probeRpcHealth).toBeTypeOf('function')

    sdk.clearCustomRpcOverride(sdk.Chain.Ethereum)
    expect(sdk.isCustomRpcSupported(sdk.Chain.Ethereum)).toBe(true)
    expect(sdk.isCustomRpcSupported(sdk.Chain.THORChain)).toBe(false)
    sdk.setCustomRpcOverride(sdk.Chain.Ethereum, ' https://rpc.example ')
    expect(sdk.getCustomRpcOverride(sdk.Chain.Ethereum)).toBe('https://rpc.example')
    expect(sdk.getCustomRpcOverrides()).toEqual({ [sdk.Chain.Ethereum]: 'https://rpc.example' })
    sdk.clearCustomRpcOverride(sdk.Chain.Ethereum)
    expect(sdk.getCustomRpcOverride(sdk.Chain.Ethereum)).toBeUndefined()
  })

  it('exports isValidTokenId for non-address token families (Sui struct tags, XRPL currency.issuer)', () => {
    expect(sdk.isValidTokenId).toBe(isValidTokenIdModule.isValidTokenId)

    // Sui + a malformed Ripple id never reach the walletCore-dependent
    // address-validation branch, so these are safe to exercise for real here.
    expect(sdk.isValidTokenId({ chain: sdk.Chain.Sui, id: '0x2::sui::SUI', walletCore: {} as never })).toBe(true)
    expect(sdk.isValidTokenId({ chain: sdk.Chain.Sui, id: 'not-a-struct-tag', walletCore: {} as never })).toBe(false)
    expect(sdk.isValidTokenId({ chain: sdk.Chain.Ripple, id: 'not-a-composite-id', walletCore: {} as never })).toBe(
      false
    )
  })

  it('exports prepareTrc20TransferFromKeys (pure-crypto TRC-20 builder for mcp-ts/backend)', () => {
    expect(typeof sdk.prepareTrc20TransferFromKeys).toBe('function')
    expect(sdk.TRC20_TRANSFER_SELECTOR).toBe('transfer(address,uint256)')
    // Builds an unsigned descriptor with no RPC/signing material.
    const tx = sdk.prepareTrc20TransferFromKeys({
      contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      from: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
      to: 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH',
      amount: '1000000',
    })
    expect(tx.functionSelector).toBe('transfer(address,uint256)')
    expect(tx.parameter).toHaveLength(128)
  })

  it('exports canonical Sui/UTXO prep constants alongside the prep builders', () => {
    expect(sdk.SUI_NATIVE_COIN_TYPE).toBe('0x2::sui::SUI')
    expect(sdk.CONSOLIDATE_CHAINS).toEqual([
      sdk.Chain.Bitcoin,
      sdk.Chain.Litecoin,
      sdk.Chain.Dogecoin,
      sdk.Chain.BitcoinCash,
      sdk.Chain.Dash,
    ])
  })

  it('exports Solana balance reads (native SOL + SPL) for mcp-ts consumers', () => {
    expect(typeof sdk.getSolBalance).toBe('function')
    expect(typeof sdk.getSplTokenBalance).toBe('function')
  })

  it('exports canonical swap tracker URL helpers for first-party consumers', () => {
    expect(typeof sdk.getSwapExplorerUrl).toBe('function')
    expect(Array.isArray(sdk.swapExplorerProviders)).toBe(true)
    expect(
      sdk.getSwapExplorerUrl({
        provider: 'li.fi',
        txHash: '0xabc',
        fromChain: sdk.Chain.Base,
      })
    ).toBe('https://scan.li.fi/tx/0xabc')
  })

  it('exports Noon USDC yield helpers for Windows and Station consumers', () => {
    expect(sdk.noonUsdcVaultConfig).toBeDefined()
    expect(typeof sdk.encodeNoonDeposit).toBe('function')
    expect(typeof sdk.getNoonDepositTxPlan).toBe('function')
    expect(typeof sdk.readNoonVaultState).toBe('function')
    expect(typeof sdk.fetchNoonUsdcVaultMetrics).toBe('function')
  })

  it('exports the sdk.decode namespace documented as the canonical bytes-oracle keystone', () => {
    // `packages/sdk/src/tools/policy/types.ts` documents the canonical
    // decoder as `sdk.decode.fromToolResult` — pin that exact shape, aliased
    // from (not duplicating) the flat sdk.decodeFromToolResult export.
    expect(sdk.decode).toBeDefined()
    expect(sdk.decode.fromToolResult).toBe(sdk.decodeFromToolResult)
    expect(sdk.decode.decodeCosmosTx).toBe(sdk.decodeCosmosTx)
    expect(sdk.decode.decodeEvmTx).toBe(sdk.decodeEvmTx)
  })

  it('exports the sdk.defi namespace with the Arkis lender supply builder', () => {
    expect(sdk.defi).toBeDefined()
    expect(sdk.defi.arkis).toBeDefined()
    expect(typeof sdk.defi.arkis.buildArkisSupplyTx).toBe('function')
    expect(typeof sdk.defi.arkis.parseArkisTokenAmount).toBe('function')
    expect(typeof sdk.defi.arkis.resolveArkisPoolKind).toBe('function')
    expect(sdk.defi.arkis.ARKIS_OFFICIAL_ADDRESSES.dispatcher).toBe('0x2f01D7CFfe62673B3D2b680295A2D047F3848e4c')
  })

  it('exports Balancer V3 calldata builder on the root sdk surface alongside other DeFi builders', () => {
    expect(typeof sdk.buildBalancerV3SwapCalldata).toBe('function')
    expect(typeof sdk.buildBuyPt).toBe('function')
    expect(typeof sdk.defi.balancer.buildBalancerV3SwapCalldata).toBe('function')
    expect(sdk.buildBalancerV3SwapCalldata).toBe(sdk.defi.balancer.buildBalancerV3SwapCalldata)
  })

  it('exports the full River helper family from the root sdk surface', () => {
    expect(typeof sdk.describeRiverMarket).toBe('function')
    expect(typeof sdk.findRiverInsertHints).toBe('function')
    expect(typeof sdk.formatRiverPercentWad).toBe('function')
    expect(Array.isArray(sdk.RIVER_TROVE_STATUS_NAMES)).toBe(true)
    expect(typeof sdk.riverStatusName).toBe('function')
    expect(sdk.river.describeMarket).toBe(sdk.describeRiverMarket)
    expect(sdk.river.findInsertHints).toBe(sdk.findRiverInsertHints)
  })

  it('exports Chain enum, cosmos chain subsets, chain helpers, and VaultBase class for first-party consumers', () => {
    expect(sdk.Chain).toBeDefined()
    expect(sdk.IbcEnabledCosmosChain.TerraClassic).toBe('TerraClassic')
    expect(sdk.VaultBasedCosmosChain.THORChain).toBe('THORChain')
    expect(Object.values(sdk.IbcEnabledCosmosChain)).not.toContain(sdk.Chain.THORChain)
    expect(Object.values(sdk.VaultBasedCosmosChain)).toEqual([sdk.Chain.THORChain, sdk.Chain.MayaChain])
    expect(typeof sdk.getChainKind).toBe('function')
    expect(typeof sdk.isChainOfKind).toBe('function')
    expect(sdk.chainFeeCoin.Ethereum.ticker).toBe('ETH')
    expect(typeof sdk.VaultBase).toBe('function')
    expect(typeof sdk.BroadcastPartialFailureError).toBe('function')
  })

  it('exports chain kind and native fee coin metadata for client boundary consumers', () => {
    expect(typeof sdk.getChainKind).toBe('function')
    expect(sdk.getChainKind(sdk.Chain.Ethereum)).toBe('evm')
    expect(sdk.chainFeeCoin[sdk.Chain.Ethereum]?.ticker).toBe('ETH')
  })

  it('exports the THOR/Maya swap-memo parser for downstream consumers', () => {
    expect(typeof sdk.parseThorSwapMemo).toBe('function')
  })

  it('exports the shared THORChain secured-asset catalog helpers', () => {
    expect(typeof sdk.getThorchainSecuredAssetCatalog).toBe('function')
    expect(typeof sdk.createThorchainSecuredAssetCatalog).toBe('function')
    expect(typeof sdk.getThorchainSecuredAssetL1Asset).toBe('function')
    expect(typeof sdk.getThorchainSwapDestinationAssets).toBe('function')
    expect(sdk.thorchainSecuredAssetFallback.length).toBeGreaterThan(10)
  })

  it('exports canonical EVM chain-id, RPC, and priority-fee-clamp helpers from the root sdk surface', () => {
    expect(typeof sdk.getEvmChainId).toBe('function')
    expect(typeof sdk.getEvmChainByChainId).toBe('function')
    expect(typeof sdk.getEvmRpcUrl).toBe('function')
    expect(typeof sdk.clampEvmPriorityFee).toBe('function')
    expect(sdk.getEvmChainId(sdk.Chain.Mantle)).toBe('0x1388')
    expect(sdk.getEvmChainByChainId('0x3e7')).toBe(sdk.Chain.Hyperliquid)
    expect(sdk.getEvmRpcUrl(sdk.Chain.Ethereum)).toBe('https://api.vultisig.com/eth/')
    expect(sdk.getEvmRpcUrl(sdk.Chain.Hyperliquid)).toBe('https://api.vultisig.com/hyperevm/')
    expect(
      sdk.clampEvmPriorityFee(sdk.Chain.Base as Parameters<typeof sdk.clampEvmPriorityFee>[0], 75n * 1_000_000_000n)
    ).toBe(50n * 1_000_000_000n)
  })

  it('exports gas comparison helpers from the root sdk surface', () => {
    expect(typeof sdk.compareCosts).toBe('function')
    expect(Array.isArray(sdk.DEFAULT_COMPARE_CHAINS)).toBe(true)
    expect(sdk.GAS_UNITS.transfer).toBe(21000)
    expect(typeof sdk.getChainGasPriceGwei).toBe('function')
  })

  it.each(cosmosTxFeeGasParityCases)(
    'exports the canonical $chain fee denom, fee amount, and gas limit together',
    ({ chain, feeDenom, feeAmount, gasLimit }) => {
      expect(sdk.cosmosFeeCoinDenom[chain]).toBe(feeDenom)
      expect(sdk.getCosmosSendFeeBaseUnits(chain)).toBe(feeAmount)
      expect(sdk.getCosmosGasLimit({ chain })).toBe(gasLimit)
    }
  )

  it('covers every Cosmos chain exposed by the root SDK entry', () => {
    const exposedCosmosChains = Object.values(sdk.Chain).filter(chain => sdk.getChainKind(chain) === 'cosmos')

    expect(new Set(cosmosTxFeeGasParityCases.map(({ chain }) => chain))).toEqual(new Set(exposedCosmosChains))
  })

  it('exports the shared Cosmos send-fee constants used by the parity matrix', () => {
    expect(sdk.COSMOS_SEND_FEE_DEFAULT).toBe(7_500n)
    expect(sdk.MAYA_SEND_FEE_BASE_UNITS).toBe(2_000_000_000n)
  })

  it('exports the Cosmos staking gas limit helper, including TerraClassic redelegation headroom', () => {
    expect(typeof sdk.getCosmosStakingGasLimit).toBe('function')
    expect(sdk.getCosmosStakingGasLimit({ chain: sdk.Chain.Cosmos })).toBe(350_000n)
    expect(sdk.getCosmosStakingGasLimit({ chain: sdk.Chain.Cosmos, msgCount: 2 })).toBe(437_500n)
    expect(sdk.getCosmosStakingGasLimit({ chain: sdk.Chain.TerraClassic })).toBe(4_000_000n)
  })

  it('exports a TerraClassic staking fee correctly priced for the staking gas limit, not the send fee', () => {
    expect(sdk.TERRA_CLASSIC_STAKING_ULUNA_FEE_BASE_UNITS).toBe(113_300_000n)
    // The send-fee constant is priced for the 300k send gas limit and would
    // under-price a 4M-gas staking tx by ~13x, causing the node to reject it
    // for insufficient fees before it can broadcast.
    expect(sdk.TERRA_CLASSIC_STAKING_ULUNA_FEE_BASE_UNITS).toBeGreaterThan(
      sdk.getCosmosSendFeeBaseUnits(sdk.Chain.TerraClassic)!
    )
  })

  it('exports a composable TerraClassic redelegation message and sufficient staking gas/fee pair', () => {
    const gasLimit = sdk.getCosmosStakingGasLimit({ chain: sdk.Chain.TerraClassic })
    const msg = sdk.cosmosStaking.redelegate({
      delegatorAddress: 'terra1qyqszqgpqyqszqgpqyqszqgpqyqszqgp5hm70u',
      validatorSrcAddress: 'terravaloper1qgpqyqszqgpqyqszqgpqyqszqgpqyqsz9u3x5e',
      validatorDstAddress: 'terravaloper1qvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcryvs87c',
      amount: '1000000',
      denom: 'uluna',
    })

    // The React Native entrypoint test exercises the actual SignDoc builder;
    // this root-surface contract proves consumers can compose the message with
    // the matching gas and fee exports instead of a stale hand-picked value.
    const requiredFee = (gasLimit * 28_325n) / 1000n
    expect(sdk.TERRA_CLASSIC_STAKING_ULUNA_FEE_BASE_UNITS).toBeGreaterThanOrEqual(requiredFee)
    expect(msg.typeUrl).toBe('/cosmos.staking.v1beta1.MsgBeginRedelegate')
  })

  it('exports the canonical Cosmos custom-signing payload builders', () => {
    expect(sdk.buildSignAminoKeysignPayload).toBe(canonicalBuildSignAminoKeysignPayload)
    expect(sdk.buildSignDirectKeysignPayload).toBe(canonicalBuildSignDirectKeysignPayload)
  })

  it('exports seedphrase import chain support policy for consumers', () => {
    expect(Array.isArray(sdk.SEEDPHRASE_IMPORT_SUPPORTED_CHAINS)).toBe(true)
    expect(Array.isArray(sdk.SEEDPHRASE_IMPORT_UNSUPPORTED_CHAINS)).toBe(true)
    expect(typeof sdk.isSeedphraseImportSupportedChain).toBe('function')
  })

  it('exports the canonical node vault-backup helpers and constants from the root surface', async () => {
    const libEncrypt = await import('@vultisig/lib-utils/encryption/vaultBackup/encryptVaultBackupWithPassword')
    const libDecrypt = await import('@vultisig/lib-utils/encryption/vaultBackup/decryptVaultBackupWithPassword')
    const constants = await import('@vultisig/lib-utils/encryption/vaultBackup/vaultBackupConstants')

    expect(sdk.encryptVaultBackupWithPassword).toBe(libEncrypt.encryptVaultBackupWithPassword)
    expect(sdk.decryptVaultBackupWithPassword).toBe(libDecrypt.decryptVaultBackupWithPassword)
    expect(sdk.DEFAULT_VAULT_BACKUP_PBKDF2_ITERATIONS).toBe(constants.DEFAULT_VAULT_BACKUP_PBKDF2_ITERATIONS)
    expect(Buffer.from(sdk.VAULT_BACKUP_BLOB_MAGIC)).toEqual(Buffer.from(constants.VAULT_BACKUP_BLOB_MAGIC))
    expect(sdk.VAULT_BACKUP_SALT_LEN).toBe(constants.VAULT_BACKUP_SALT_LEN)
    expect(sdk.VAULT_BACKUP_IV_LEN).toBe(constants.VAULT_BACKUP_IV_LEN)
    expect(sdk.VAULT_BACKUP_MAGIC_LEN).toBe(constants.VAULT_BACKUP_MAGIC_LEN)
    expect(sdk.VAULT_BACKUP_PBKDF2_HEADER_LEN).toBe(constants.VAULT_BACKUP_PBKDF2_HEADER_LEN)
  })

  it('exports canonical defaultChains helpers for app onboarding/import parity', () => {
    expect(Array.isArray(sdk.DEFAULT_CHAINS)).toBe(true)
    expect(Array.isArray(sdk.defaultChains)).toBe(true)
    expect(sdk.DEFAULT_CHAINS).toBe(sdk.defaultChains)
    expect(sdk.DEFAULT_CHAINS).toEqual([
      sdk.Chain.Bitcoin,
      sdk.Chain.Ethereum,
      sdk.Chain.THORChain,
      sdk.Chain.Solana,
      sdk.Chain.BSC,
    ])
  })

  it('exports the pairing-QR payload builder from the root SDK surface', async () => {
    const services = await import('../../../src/services/buildKeygenPairingQrPayload')

    expect(typeof sdk.buildKeygenPairingQrPayload).toBe('function')
    expect(sdk.buildKeygenPairingQrPayload).toBe(services.buildKeygenPairingQrPayload)
  })

  it('exports generic CosmWasm amino and protobuf execute builders', () => {
    expect(typeof sdk.buildCosmosWasmExecuteMsg).toBe('function')
    expect(typeof sdk.buildCosmosWasmExecuteTx).toBe('function')
  })

  it('VaultBase prototype exposes prep-only primitives used by mcp-ts execute_* tools', () => {
    // prepareSendTx / prepareSwapTx / prepareContractCallTx are public instance
    // methods on VaultBase — they build a KeysignPayload without broadcasting.
    const proto = sdk.VaultBase.prototype as unknown as Record<string, unknown>
    expect(typeof proto.prepareSendTx).toBe('function')
    expect(typeof proto.prepareSwapTx).toBe('function')
    expect(typeof proto.prepareContractCallTx).toBe('function')
  })
})
