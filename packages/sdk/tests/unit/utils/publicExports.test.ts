import { describe, expect, it } from 'vitest'

import * as sdk from '../../../src/index'

describe('@vultisig/sdk public exports', () => {
  it('exports fiatToAmount and normalizeChain utilities', () => {
    expect(typeof sdk.fiatToAmount).toBe('function')
    expect(typeof sdk.normalizeChain).toBe('function')
    expect(typeof sdk.FiatToAmountError).toBe('function')
    expect(typeof sdk.UnknownChainError).toBe('function')
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

  it('exports Noon USDC yield helpers for Windows and Station consumers', () => {
    expect(sdk.noonUsdcVaultConfig).toBeDefined()
    expect(typeof sdk.encodeNoonDeposit).toBe('function')
    expect(typeof sdk.getNoonDepositTxPlan).toBe('function')
    expect(typeof sdk.readNoonVaultState).toBe('function')
    expect(typeof sdk.fetchNoonUsdcVaultMetrics).toBe('function')
  })

  it('exports Chain enum and VaultBase class (VaultBase carries the prep-only primitives)', () => {
    expect(sdk.Chain).toBeDefined()
    expect(typeof sdk.VaultBase).toBe('function')
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
