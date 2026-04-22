// Named-object aggregation — rollup drops `export * as namespace` patterns
// silently when nested (e.g. `export * as chains from './chains'` where
// `./chains/index.ts` itself uses `export * as cosmos from './cosmos'`).
// Using explicit `import *` + `export const` survives the bundler intact and
// yields `chains.cosmos.buildCosmosSendTx` at the consumer.

import * as cosmos from './cosmos'
import * as evm from './evm'
import * as solana from './solana'
import * as sui from './sui'

export const chains = { cosmos, evm, solana, sui }

// Re-export Cosmos type surfaces so consumers can `import type { BuildCosmosSendOptions } from '.../chains'`.
// Sui module currently exposes only functions; add type re-exports here when the sui/tx.ts module declares them.
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
export type { BuildSolanaSendOptions, SolanaTxBuilderResult } from './solana'
