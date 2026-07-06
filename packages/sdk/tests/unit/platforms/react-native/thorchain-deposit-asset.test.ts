/**
 * THORChain-family MsgDeposit asset parametrization.
 *
 * buildThorchainDepositTx hardcoded THOR.RUNE as the deposit Coin's Asset
 * until this PR. MayaChain is a THORChain fork whose MsgDeposit is
 * byte-identical except for the Asset { chain, symbol, ticker } — MAYA.CACAO
 * instead of THOR.RUNE. These tests pin:
 *   - default (no `asset` opt) still encodes THOR.RUNE, so every existing
 *     THORChain LP/swap caller is unaffected (back-compat).
 *   - passing `asset: { chain: 'MAYA', symbol: 'CACAO', ticker: 'CACAO' }`
 *     encodes the Maya asset instead.
 *
 * There's no cosmjs-types reference encoder for THORChain's custom
 * /types.MsgDeposit (it's not a standard cosmos-sdk message), so this mirrors
 * the hex-substring assertion style already used by vultiagent-poc's
 * cosmosTx.test.ts for the same hand-rolled builder.
 */
import { describe, expect, it } from 'vitest'

import { buildThorchainDepositTx } from '../../../../src/platforms/react-native/chains/cosmos/tx'

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

const FX = {
  chainId: 'thorchain-1',
  signer: 'thor1g98cy3n9mmjrpn0sxmn63lztelera37n8n67c0',
  amount: '100000000',
  // Neutral memo (no chain-name substrings) so the asset-encoding assertions
  // below aren't confounded by chain names appearing in the memo bytes too.
  memo: '+:pool1:1000000',
  // Realistic CACAO->RUNE swap memo — deliberately contains "THOR.RUNE" as
  // the swap destination asset, used only by the memo-passthrough test.
  swapMemo: '=:THOR.RUNE:thor1dest::0:0',
  sequence: 5,
  accountNumber: 42,
  pubKey: new Uint8Array(33).fill(0x02),
  gasLimit: 2_000_000,
  feeAmount: '0',
}

function baseOpts(overrides: Partial<Parameters<typeof buildThorchainDepositTx>[0]> = {}) {
  return {
    chainId: FX.chainId,
    fromAddress: FX.signer,
    amountBaseUnits: FX.amount,
    memo: FX.memo,
    sequence: FX.sequence,
    accountNumber: FX.accountNumber,
    pubKeyBytes: FX.pubKey,
    gasLimit: FX.gasLimit,
    feeDenom: 'rune',
    feeAmount: FX.feeAmount,
    ...overrides,
  }
}

describe('buildThorchainDepositTx / asset parametrization', () => {
  it('defaults to THOR.RUNE when no asset override is passed (THORChain back-compat)', () => {
    const built = buildThorchainDepositTx(baseOpts())
    const hex = toHex(built.txBodyBytes)
    // "THOR" = 0x54484f52, "RUNE" = 0x52554e45 (appears twice: symbol + ticker)
    expect(hex).toContain('54484f52')
    const runeMatches = hex.match(/52554e45/g) ?? []
    expect(runeMatches.length).toBeGreaterThanOrEqual(2)
    expect(hex).not.toContain('4d415941') // "MAYA"
  })

  it('encodes MAYA.CACAO when asset override targets MayaChain', () => {
    const built = buildThorchainDepositTx(
      baseOpts({
        chainId: 'mayachain-mainnet-v1',
        feeDenom: 'cacao',
        asset: { chain: 'MAYA', symbol: 'CACAO', ticker: 'CACAO' },
      })
    )
    const hex = toHex(built.txBodyBytes)
    // "MAYA" = 0x4d415941, "CACAO" = 0x434143414f (appears twice: symbol + ticker)
    expect(hex).toContain('4d415941')
    const cacaoMatches = hex.match(/434143414f/g) ?? []
    expect(cacaoMatches.length).toBeGreaterThanOrEqual(2)
    expect(hex).not.toContain('54484f52') // "THOR"
  })

  it('carries a realistic CACAO->RUNE swap memo and amount through untouched', () => {
    const built = buildThorchainDepositTx(
      baseOpts({
        memo: FX.swapMemo,
        asset: { chain: 'MAYA', symbol: 'CACAO', ticker: 'CACAO' },
      })
    )
    const hex = toHex(built.txBodyBytes)
    // amount "100000000" as ASCII
    expect(hex).toContain(Buffer.from(FX.amount, 'ascii').toString('hex'))
    // swap memo ASCII (destination asset THOR.RUNE legitimately appears here —
    // it's the swap's destination, not the deposit Coin's asset)
    expect(hex).toContain(Buffer.from(FX.swapMemo, 'ascii').toString('hex'))
    // deposit Coin's own asset is still MAYA.CACAO, not THOR.RUNE
    expect(hex).toContain('4d415941')
  })
})
