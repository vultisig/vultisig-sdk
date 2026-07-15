import { describe, expect, it } from 'vitest'

import * as sdk from '../../../src/index'

describe('@vultisig/sdk public exports', () => {
  it('exports fiatToAmount and normalizeChain utilities', () => {
    expect(typeof sdk.fiatToAmount).toBe('function')
    expect(typeof sdk.normalizeChain).toBe('function')
    expect(typeof sdk.FiatToAmountError).toBe('function')
    expect(typeof sdk.UnknownChainError).toBe('function')
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

  it('exports Noon USDC yield helpers for Windows and Station consumers', () => {
    expect(sdk.noonUsdcVaultConfig).toBeDefined()
    expect(typeof sdk.encodeNoonDeposit).toBe('function')
    expect(typeof sdk.getNoonDepositTxPlan).toBe('function')
    expect(typeof sdk.readNoonVaultState).toBe('function')
    expect(typeof sdk.fetchNoonUsdcVaultMetrics).toBe('function')
  })

  it('exports the sdk.defi namespace with the Arkis lender supply builder', () => {
    expect(sdk.defi).toBeDefined()
    expect(sdk.defi.arkis).toBeDefined()
    expect(typeof sdk.defi.arkis.buildArkisSupplyTx).toBe('function')
    expect(typeof sdk.defi.arkis.parseArkisTokenAmount).toBe('function')
    expect(typeof sdk.defi.arkis.resolveArkisPoolKind).toBe('function')
    expect(sdk.defi.arkis.ARKIS_OFFICIAL_ADDRESSES.dispatcher).toBe('0x2f01D7CFfe62673B3D2b680295A2D047F3848e4c')
  })

  it('exports Chain enum and VaultBase class (VaultBase carries the prep-only primitives)', () => {
    expect(sdk.Chain).toBeDefined()
    expect(typeof sdk.VaultBase).toBe('function')
  })

  it('exports chain kind and native fee coin metadata for client boundary consumers', () => {
    expect(typeof sdk.getChainKind).toBe('function')
    expect(sdk.getChainKind(sdk.Chain.Ethereum)).toBe('evm')
    expect(sdk.chainFeeCoin[sdk.Chain.Ethereum]?.ticker).toBe('ETH')
  })

  it('exports seedphrase import chain support policy for consumers', () => {
    expect(Array.isArray(sdk.SEEDPHRASE_IMPORT_SUPPORTED_CHAINS)).toBe(true)
    expect(Array.isArray(sdk.SEEDPHRASE_IMPORT_UNSUPPORTED_CHAINS)).toBe(true)
    expect(typeof sdk.isSeedphraseImportSupportedChain).toBe('function')
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
