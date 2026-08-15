/**
 * Grouped `sdk.prep.*` namespace, matching the documented
 * `sdk.prep.prepareSendTxFromKeys` shape (issue #1912 verification target).
 *
 * Imports per-file rather than the `./index` barrel, mirroring
 * `vault/services/TransactionBuilder.ts` (which avoids the barrel because it
 * pulls in `./cosmos.ts` → `buildCosmosPayload` → THORChain modules at
 * module-load time, breaking vitest setups that mock `chainFeeCoin`).
 * `prepareSendTxFromKeys` / `prepareContractCallTxFromKeys` /
 * `prepareSignAminoTxFromKeys` / `prepareSignDirectTxFromKeys` /
 * `prepareThorchainMsgDepositTxFromKeys` are proven React-Native-bundle-safe
 * as static imports: `TransactionBuilder` already imports them the same way
 * and is unconditionally reachable from the shared `Vultisig` class via
 * `VaultBase`.
 *
 * Deliberately EXCLUDES `buildSplTransfer` (statically pulls
 * `@solana/web3.js`, lazy-imported at the React Native entry for that reason)
 * plus `getMaxSendAmountFromKeys`, `prepareJettonTransferTxFromKeys`,
 * `prepareSwapTxFromKeys`, `prepareTrc20TransferFromKeys`,
 * `prepareUtxoConsolidateTxFromKeys`, `prepareSuiTokenTransferFromKeys`, and
 * `prepareIbcTransfer` — the React Native entry lazy-imports (or omits) these
 * too, and unlike the five above, nothing in this codebase yet proves them
 * safe as static imports on the shared class. They remain reachable via their
 * existing flat exports; a follow-up can move them into this namespace once
 * their RN-bundle safety is confirmed.
 */
import { prepareContractCallTxFromKeys } from './contractCall'
import { prepareSignAminoTxFromKeys, prepareSignDirectTxFromKeys } from './cosmos'
import {
  buildDelegateMsg,
  buildRedelegateMsg,
  buildUndelegateMsg,
  buildWithdrawRewardsMsg,
  cosmosStaking,
} from './cosmosStaking'
import { buildCosmosWasmExecuteMsg } from './cosmosWasmExecute'
import { buildCw20TransferMsg } from './cw20Transfer'
import { POLKADOT_ASSET_HUB_KNOWN_ASSETS, preparePolkadotAssetSend } from './polkadotAssetSend'
import { prepareSendTxFromKeys } from './send'
import { SUI_NATIVE_COIN_TYPE } from './suiTokenTransfer'
import { prepareThorchainMsgDepositTxFromKeys } from './thorchainMsgDeposit'
import { TRC20_TRANSFER_SELECTOR } from './trc20'
import { CONSOLIDATE_CHAINS } from './utxoConsolidate'

export const prep = {
  prepareSendTxFromKeys,
  prepareContractCallTxFromKeys,
  prepareSignAminoTxFromKeys,
  prepareSignDirectTxFromKeys,
  prepareThorchainMsgDepositTxFromKeys,
  buildDelegateMsg,
  buildRedelegateMsg,
  buildUndelegateMsg,
  buildWithdrawRewardsMsg,
  cosmosStaking,
  buildCosmosWasmExecuteMsg,
  buildCw20TransferMsg,
  preparePolkadotAssetSend,
  POLKADOT_ASSET_HUB_KNOWN_ASSETS,
  SUI_NATIVE_COIN_TYPE,
  TRC20_TRANSFER_SELECTOR,
  CONSOLIDATE_CHAINS,
} as const

export type Prep = typeof prep
