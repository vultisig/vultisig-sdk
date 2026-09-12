import './initializePrep'

export { getWalletCore } from '../../context/wasmRuntime'

// Vault-free prep helpers (KeysignPayload construction without an instantiated vault)
export type * from '../../tools/prep'

// Pure cosmos staking msg-envelope builders. These depend only on bech32 +
// buffer (RN-safe, no mpc/keysign), so unlike the other prep helpers they are
// statically re-exported rather than lazy-imported. Omitting them here would
// break the hand-curated RN export list for vultiagent-app consumers.
export {
  IBC_CHAIN_HRP,
  IBC_CHAIN_REVISION,
  IBC_CHANNEL_DEST,
  IBC_MSG_TRANSFER_TYPE_URL,
  normaliseIbcChainId,
  prepareIbcTransfer,
  prepareSuiTokenTransferFromKeys,
  resolveSourceChannelByDestChain,
  supportedIbcDestinationsFrom,
} from '../../tools/prep'
export type {
  CosmosStakingMsgEnvelope,
  DelegateParams,
  RedelegateParams,
  UndelegateParams,
  WithdrawRewardsParams,
} from '../../tools/prep/cosmosStaking'
export {
  buildDelegateMsg,
  buildRedelegateMsg,
  buildUndelegateMsg,
  buildWithdrawRewardsMsg,
  cosmosStaking,
} from '../../tools/prep/cosmosStaking'
// Pure CosmWasm Amino message builders (only depend on JSON/bech32 — no
// WalletCore or native crypto, safe as static re-exports on the RN graph).
// Keep this list aligned with the root entrypoint: package exports resolve
// React Native consumers to this hand-curated module.
export type { BuildCosmosWasmExecuteMsgParams, CosmWasmExecuteFund } from '../../tools/prep/cosmosWasmExecute'
export { buildCosmosWasmExecuteMsg } from '../../tools/prep/cosmosWasmExecute'
export { buildCw20TransferMsg } from '../../tools/prep/cw20Transfer'
// `preparePolkadotAssetSend` is pure-crypto (@polkadot/util + @polkadot/util-crypto,
// both RN-safe) with no MPC/wasm dependency, so it ships as a static re-export
// rather than a lazy `await import(...)` wrapper. `POLKADOT_ASSET_HUB_KNOWN_ASSETS`
// is a plain const map. Omitting these broke RN/vultiagent-app consumption of the
// Asset Hub send builder (same hand-curated-allow-list gap as prior prep builders).
export { POLKADOT_ASSET_HUB_KNOWN_ASSETS, preparePolkadotAssetSend } from '../../tools/prep/polkadotAssetSend'
export { SUI_NATIVE_COIN_TYPE } from '../../tools/prep/suiTokenTransfer'
export { TRC20_TRANSFER_SELECTOR } from '../../tools/prep/trc20'
export { CONSOLIDATE_CHAINS } from '../../tools/prep/utxoConsolidate'

export async function getMaxSendAmountFromKeys(
  ...args: Parameters<typeof import('../../tools/prep/maxSend').getMaxSendAmountFromKeys>
) {
  const mod = await import('../../tools/prep/maxSend')
  return mod.getMaxSendAmountFromKeys(...args)
}

export async function prepareContractCallTxFromKeys(
  ...args: Parameters<typeof import('../../tools/prep/contractCall').prepareContractCallTxFromKeys>
) {
  const mod = await import('../../tools/prep/contractCall')
  return mod.prepareContractCallTxFromKeys(...args)
}

export async function prepareRawEvmTxFromKeys(
  ...args: Parameters<typeof import('../../tools/prep/rawEvm').prepareRawEvmTxFromKeys>
) {
  const mod = await import('../../tools/prep/rawEvm')
  return mod.prepareRawEvmTxFromKeys(...args)
}

export async function prepareJettonTransferTxFromKeys(
  ...args: Parameters<typeof import('../../tools/prep/jettonTransfer').prepareJettonTransferTxFromKeys>
) {
  const mod = await import('../../tools/prep/jettonTransfer')
  return mod.prepareJettonTransferTxFromKeys(...args)
}

export async function prepareSendTxFromKeys(
  ...args: Parameters<typeof import('../../tools/prep/send').prepareSendTxFromKeys>
) {
  const mod = await import('../../tools/prep/send')
  return mod.prepareSendTxFromKeys(...args)
}

export async function prepareSignAminoTxFromKeys(
  ...args: Parameters<typeof import('../../tools/prep/cosmos').prepareSignAminoTxFromKeys>
) {
  const mod = await import('../../tools/prep/cosmos')
  return mod.prepareSignAminoTxFromKeys(...args)
}

export async function prepareSignDirectTxFromKeys(
  ...args: Parameters<typeof import('../../tools/prep/cosmos').prepareSignDirectTxFromKeys>
) {
  const mod = await import('../../tools/prep/cosmos')
  return mod.prepareSignDirectTxFromKeys(...args)
}

export async function prepareSwapTxFromKeys(
  ...args: Parameters<typeof import('../../tools/prep/swap').prepareSwapTxFromKeys>
) {
  const mod = await import('../../tools/prep/swap')
  return mod.prepareSwapTxFromKeys(...args)
}

// TRON TRC-20 transfer calldata builder (pure crypto — @noble/hashes only,
// no RPC, no signing). RN-safe; lazy-imported to match the prep helper pattern
// above. Without this, RN consumers (Station / vultisig-windows) couldn't reach
// the reviewed base58check + ABI encode and would have to re-port it.
export async function prepareTrc20TransferFromKeys(
  ...args: Parameters<typeof import('../../tools/prep/trc20').prepareTrc20TransferFromKeys>
) {
  const mod = await import('../../tools/prep/trc20')
  return mod.prepareTrc20TransferFromKeys(...args)
}

// Lazy import: `splTransfer` statically pulls `@solana/web3.js`, which reads
// `globalThis.Buffer` at module-init. Deferring the import inside the async
// body keeps it out of the eager RN bundle graph (same rationale as the
// getSplAccounts / getSplAssociatedAccount overrides). The underlying builder
// is synchronous; this wrapper just defers module evaluation.
export async function buildSplTransfer(
  ...args: Parameters<typeof import('../../tools/prep/splTransfer').buildSplTransfer>
) {
  const mod = await import('../../tools/prep/splTransfer')
  return mod.buildSplTransfer(...args)
}

export async function prepareUtxoConsolidateTxFromKeys(
  ...args: Parameters<typeof import('../../tools/prep/utxoConsolidate').prepareUtxoConsolidateTxFromKeys>
) {
  const mod = await import('../../tools/prep/utxoConsolidate')
  return mod.prepareUtxoConsolidateTxFromKeys(...args)
}

export async function prepareThorchainMsgDepositTxFromKeys(
  ...args: Parameters<typeof import('../../tools/prep/thorchainMsgDeposit').prepareThorchainMsgDepositTxFromKeys>
) {
  const mod = await import('../../tools/prep/thorchainMsgDeposit')
  return mod.prepareThorchainMsgDepositTxFromKeys(...args)
}

export { SwapQuoteExpiredError } from '../../tools/prep/SwapQuoteExpiredError'
