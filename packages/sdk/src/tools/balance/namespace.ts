/**
 * Grouped `sdk.balance.*` namespace — cross-chain balance reads under one
 * object, matching the documented `sdk.balance.getEvmBalances` shape
 * (CHANGELOG #1912 / #814 family).
 *
 * Deliberately imports each chain family from its own file rather than the
 * `./index` barrel and EXCLUDES the Polkadot balance reads
 * (`balancePolkadot` / `getPolkadotNativeBalance` / `getPolkadotAssetBalance`).
 * `./index.ts` re-exports those from `./polkadot`, which statically imports
 * `@vultisig/core-chain/chains/polkadot/client` → `@polkadot/api`. That import
 * is safe on Node/browser, but this namespace object is built from the shared
 * `Vultisig` class (`Vultisig.ts`), which also bundles for React Native — and
 * `@polkadot/api`'s top-level module init pulls a BN.js double-bundle that
 * crashes Hermes (see `platforms/react-native/index.ts`'s lazy
 * `await import('../../tools/balance')` wrapper for the same functions).
 * Polkadot balance reads remain reachable via their existing flat exports
 * (`balancePolkadot`, `getPolkadotNativeBalance`, `getPolkadotAssetBalance`).
 */
import { getEvmBalances } from '../evm/balanceEvm'
import { assertBittensorAddress, decodeBittensorAddress } from './bittensor'
import { cosmosBalanceChains, getCosmosBalance, isCosmosBalanceChain } from './cosmos'
import {
  getCardanoBalance,
  getSuiAllBalances,
  getSuiBalance,
  getSuiTokenBalance,
  getTonBalance,
  getTonJettonBalance,
  getTrc20TokenBalance,
  getTronAccountResources,
  getTrxBalance,
  getXrpBalance,
} from './otherBalance'
import { getSolBalance, getSplTokenBalance } from './solana'
import { getTaoBalance } from './taoBalance'
import { formatUtxoBalance, getUtxoBalance, supportedUtxoBalanceChains } from './utxoBalance'

export const balance = {
  getEvmBalances,
  getCosmosBalance,
  cosmosBalanceChains,
  isCosmosBalanceChain,
  getUtxoBalance,
  formatUtxoBalance,
  supportedUtxoBalanceChains,
  getSolBalance,
  getSplTokenBalance,
  getXrpBalance,
  getTrc20TokenBalance,
  getTronAccountResources,
  getTrxBalance,
  getTonBalance,
  getTonJettonBalance,
  getSuiAllBalances,
  getSuiBalance,
  getSuiTokenBalance,
  getCardanoBalance,
  getTaoBalance,
  assertBittensorAddress,
  decodeBittensorAddress,
} as const

// Named `BalanceNamespace` (not `Balance`) to avoid colliding with the
// unrelated per-coin `Balance` type exported from `../../types`.
export type BalanceNamespace = typeof balance
