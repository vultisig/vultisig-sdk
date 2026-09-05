import { EvmChain } from '@vultisig/core-chain/Chain'

import { CoinKey } from '../../../coin/Coin'

const zkSyncTransferGasLimit = 200_000n

const feeCoinTransferGasLimit: Record<EvmChain, bigint> = {
  [EvmChain.Ethereum]: 23_000n,
  [EvmChain.Base]: 50_000n,
  [EvmChain.Arbitrum]: 120_000n,
  [EvmChain.Polygon]: 40_000n,
  [EvmChain.Optimism]: 40_000n,
  [EvmChain.CronosChain]: 40_000n,
  [EvmChain.Blast]: 200_000n,
  [EvmChain.BSC]: 23_000n,
  [EvmChain.Avalanche]: 23_000n,
  [EvmChain.Zksync]: zkSyncTransferGasLimit,
  [EvmChain.Mantle]: 23_000n,
  [EvmChain.Hyperliquid]: 23_000n,
  [EvmChain.Sei]: 23_000n,
  [EvmChain.Robinhood]: 120_000n,
}

const defaultErc20TransferGasLimit = 120_000n

const erc20TransferGasLimit: Record<EvmChain, bigint> = {
  [EvmChain.Ethereum]: defaultErc20TransferGasLimit,
  [EvmChain.Base]: 150_000n,
  [EvmChain.Arbitrum]: defaultErc20TransferGasLimit,
  [EvmChain.Polygon]: defaultErc20TransferGasLimit,
  [EvmChain.Optimism]: defaultErc20TransferGasLimit,
  [EvmChain.CronosChain]: defaultErc20TransferGasLimit,
  [EvmChain.Blast]: 200_000n,
  [EvmChain.BSC]: defaultErc20TransferGasLimit,
  [EvmChain.Avalanche]: defaultErc20TransferGasLimit,
  [EvmChain.Zksync]: zkSyncTransferGasLimit,
  [EvmChain.Mantle]: defaultErc20TransferGasLimit,
  [EvmChain.Hyperliquid]: defaultErc20TransferGasLimit,
  [EvmChain.Sei]: defaultErc20TransferGasLimit,
  [EvmChain.Robinhood]: defaultErc20TransferGasLimit,
}

/**
 * Lowest gas limit a plain transfer of `coin` is signed with. A live
 * `eth_estimateGas` result is preferred and only raised to this when it comes
 * in lower or cannot be obtained.
 */
export const getEvmTransferGasLimit = ({ id, chain }: CoinKey<EvmChain>): bigint =>
  (id ? erc20TransferGasLimit : feeCoinTransferGasLimit)[chain]

/**
 * Gas limit a contract call (aggregator swap, dApp transaction) falls back to
 * when it cannot be simulated, e.g. a swap quoted before its token allowance
 * exists. Mantle meters gas in far larger units than other chains.
 */
export const getEvmContractCallGasLimit = (chain: EvmChain): bigint =>
  chain === EvmChain.Mantle ? 3_000_000_000n : 600_000n

/**
 * Gas limit signed for a THORChain or Maya deposit leaving an EVM chain: a
 * memo-carrying transfer to the inbound vault for the fee coin, a router
 * `depositWithExpiry` call for a token. Sized like an ERC-20 transfer, which
 * comfortably covers both.
 */
export const evmRouterDepositGasLimit = 120_000n

type DeriveEvmGasLimitInput = {
  coin: CoinKey<EvmChain>
  data?: string
}

/**
 * Fallback gas limit for a transaction that could not be simulated: the
 * contract-call default when it carries calldata, the transfer default otherwise.
 */
export const deriveEvmGasLimit = ({ coin, data }: DeriveEvmGasLimitInput): bigint =>
  data ? getEvmContractCallGasLimit(coin.chain) : getEvmTransferGasLimit(coin)
