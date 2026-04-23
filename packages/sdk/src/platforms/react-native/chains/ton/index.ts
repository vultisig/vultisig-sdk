/**
 * React-Native TON bridge — re-exports the Hermes-safe primitives from
 * `packages/sdk/src/chains/ton`. Kept as a dedicated re-export module to
 * mirror the existing `chains/cosmos`, `chains/sui`, etc. pattern and to
 * let the rollup RN bundle avoid module-init evaluation of `@ton/*` until
 * a consumer actually touches a TON function.
 *
 * Why no direct `export * from '../../../../chains/ton'`: rollup drops
 * nested `export * as ...` patterns silently; the named `chains = { ton }`
 * object in `../index.ts` must see each bridge as a flat module.
 */
export type {
  BuildTonJettonTransferOptions,
  BuildTonSendOptions,
  TonTxBuilderResult,
  TonV4R2Wallet,
  TonWalletInfo,
  TonWalletStatus,
} from '../../../../chains/ton'
export {
  broadcastTonTx,
  buildTonJettonTransferTx,
  buildTonSendTx,
  buildV4R2Wallet,
  deriveTonAddress,
  getTonBalance,
  getTonWalletInfo,
  sha256,
  TON_V4R2_SUB_WALLET_ID,
  validateTonMemo,
} from '../../../../chains/ton'
