// Named-object aggregation — rollup drops `export * as namespace` patterns
// silently when nested (e.g. `export * as chains from './chains'` where
// `./chains/index.ts` itself uses `export * as cosmos from './cosmos'`).
// Using explicit `import *` + `export const` survives the bundler intact and
// yields `chains.cosmos.buildCosmosSendTx` at the consumer.

import * as cardano from './cardano'
import * as cosmos from './cosmos'
import * as evm from './evm'
import * as ripple from './ripple'
import * as solana from './solana'
import * as sui from './sui'
import * as ton from './ton'
import * as tron from './tron'
import * as utxo from './utxo'

export const chains = { cardano, cosmos, evm, ripple, solana, sui, ton, tron, utxo }

// Re-export chain-specific type surfaces so consumers can import them from
// the `chains` barrel without knowing which sub-module they live in. Sui
// module currently exposes only functions; add type re-exports here when
// sui/tx.ts declares them.
export type {
  BuildCosmosSendOptions,
  BuildCosmosWasmExecuteOptions,
  BuildCw20TransferOptions,
  BuildThorchainDepositOptions,
  CosmosTxBuilderResult,
} from './cosmos'
export type {
  BuildErc20ApproveOptions,
  BuildErc20TransferOptions,
  BuildEvmContractCallOptions,
  BuildEvmSendOptions,
  EvmTxBuilderResult,
} from './evm'
export type {
  BuildXrpSendOptions,
  BuildXrpSendResult,
  XrpAccountInfo,
  XrpPaymentTx,
  XrpSubmitResult,
} from './ripple'
export type { BuildSolanaSendOptions, SolanaTxBuilderResult } from './solana'
export type {
  BuildTonJettonTransferOptions,
  BuildTonSendOptions,
  TonTxBuilderResult,
  TonV4R2Wallet,
  TonWalletInfo,
  TonWalletStatus,
} from './ton'
export type {
  BroadcastResult as TronBroadcastResult,
  BuildTrc20TransferOptions,
  BuildTronSendOptions,
  EstimateTrc20EnergyOptions,
  TronAccountInfo,
  TronBlockRefs,
  TronTxBuilderResult,
} from './tron'
export type {
  BroadcastUtxoTxOptions,
  BuildUtxoSendOptions,
  DecodedAddress,
  EstimateUtxoFeeOptions,
  GetUtxoBalanceOptions,
  GetUtxosOptions,
  PlainUtxo,
  SighashBIP143Options,
  SighashLegacyOptions,
  UtxoApiKind,
  UtxoApiOptions,
  UtxoChainName,
  UtxoInput,
  UtxoTxBuilderResult,
} from './utxo'
