/**
 * Native + token balance reads for non-EVM, non-Cosmos chains under one
 * `sdk.balance.<chain>()` surface: XRP / TRON / TON / Sui / Cardano / Bittensor
 * (TAO) and their token variants. Ported from the mcp-ts `balance/other-balance`
 * + `balance/bittensor-balance` tools (0 SDK imports). Pure crypto, read-only —
 * nothing here signs or broadcasts.
 */

// XRP
export type { XrpBalance } from './otherBalance'
export { getXrpBalance } from './otherBalance'

// TRON
export type { Trc20TokenBalance, TronAccountResources, TrxBalance } from './otherBalance'
export { getTrc20TokenBalance, getTronAccountResources, getTrxBalance } from './otherBalance'

// TON
export type { TonBalance, TonJettonBalance } from './otherBalance'
export { getTonBalance, getTonJettonBalance } from './otherBalance'

// Sui
export type { SuiAllBalancesResult, SuiBalance, SuiCoinBalance, SuiTokenBalance } from './otherBalance'
export { getSuiAllBalances, getSuiBalance, getSuiTokenBalance } from './otherBalance'

// Cardano
export type { CardanoBalance, CardanoNativeToken } from './otherBalance'
export { getCardanoBalance } from './otherBalance'

// Bittensor (TAO)
export type { TaoBalance } from './taoBalance'
export { getTaoBalance } from './taoBalance'

// Bittensor address validation (fund-safety: reject non-Bittensor SS58)
export { assertBittensorAddress, decodeBittensorAddress } from './bittensor'

// Shared base-unit formatting helper
export type { CosmosBalanceChain, CosmosBalanceEntry, CosmosBalanceResult } from './cosmos'
export { cosmosBalanceChains, getCosmosBalance, isCosmosBalanceChain } from './cosmos'
export { formatBalance } from './rpc'
