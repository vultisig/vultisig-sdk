// Tx builders (pure — no network I/O)
export type {
  BuildErc20ApproveOptions,
  BuildErc20TransferOptions,
  BuildEvmContractCallOptions,
  BuildEvmSendOptions,
  EvmTxBuilderResult,
} from './tx'
export {
  buildErc20ApproveTx,
  buildErc20TransferTx,
  buildEvmContractCallTx,
  buildEvmSendTx,
  encodeErc20Approve,
  encodeErc20Transfer,
  getEvmNumericChainId,
} from './tx'

// RPC helpers — accept explicit `rpcUrl` so consumers keep control
export {
  broadcastEvmRawTx,
  estimateEvmGas,
  getErc20Allowance,
  getErc20Balance,
  getErc20Decimals,
  getErc20Symbol,
  getEvmChainIdFromRpc,
  getEvmGasPrice,
  getEvmNonce,
  getEvmSuggestedFees,
} from './rpc'
