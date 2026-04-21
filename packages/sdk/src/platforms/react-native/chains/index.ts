// Named-object aggregation — rollup drops `export * as namespace` patterns
// silently when nested (e.g. `export * as chains from './chains'` where
// `./chains/index.ts` itself uses `export * as cosmos from './cosmos'`).
// Using explicit `import *` + `export const` survives the bundler intact and
// yields `chains.cosmos.buildCosmosSendTx` at the consumer.

import * as cosmos from './cosmos'
import * as sui from './sui'

export const chains = { cosmos, sui }

// Re-export type surfaces so `import type { BuildCosmosSendOptions } from '.../chains'` works.
export type {
  BuildCosmosSendOptions,
  BuildCosmosWasmExecuteOptions,
  BuildCw20TransferOptions,
  BuildThorchainDepositOptions,
  CosmosTxBuilderResult,
} from './cosmos'
export type { BuildSuiTransferOptions, SuiTxBuilderResult } from './sui'
