import { EvmChain } from '@vultisig/core-chain/Chain'

import { CoinKey } from '../../../coin/Coin'

const zkSyncTransferGasLimit = 200000n
// sdk#1847: was 90_000_000n, ~4300x what a native transfer actually uses on Mantle
// (real gas USED ~21,000; op-geth's pre-execution balance check holds
// gasLimit * maxFeePerGas, so the old floor made a "max send" strand ~6.75 MNT, and a
// wallet holding LESS than ~6.75 MNT couldn't send at all - not a display bug, real
// funds required for a limit we chose, not one the chain needs).
// 400_000n matches the LOW end of real mainnet sender behavior for a native Mantle
// transfer (400,000-900,000 observed, per the issue's own on-chain measurements) - this
// is not a value invented from the "other EVM entries" pattern in this file (those are
// all 23k-200k, sized for chains with far less L1-data-posting overhead than Mantle's
// op-geth fee model), it's the floor real senders already use successfully. capGasLimit
// (getEvmFeeQuote.ts) takes bigIntMax(estimated, thirdParty, this floor), so a live
// eth_estimateGas answer higher than 400_000n still wins - this is only the safety-net
// minimum, not the gas limit most sends will actually use.
const mantleTransferGasLimit = 400_000n

const feeCoinTransferGasLimit: Record<EvmChain, bigint> = {
  [EvmChain.Ethereum]: 23000n,
  [EvmChain.Base]: 40000n,
  [EvmChain.Arbitrum]: 120000n,
  [EvmChain.Polygon]: 23000n,
  [EvmChain.Optimism]: 40000n,
  [EvmChain.CronosChain]: 40000n,
  [EvmChain.Blast]: 40000n,
  [EvmChain.BSC]: 40000n,
  [EvmChain.Avalanche]: 23000n,
  [EvmChain.Zksync]: zkSyncTransferGasLimit,
  [EvmChain.Mantle]: mantleTransferGasLimit,
  [EvmChain.Hyperliquid]: 23000n,
  [EvmChain.Sei]: 30_000n,
  [EvmChain.Robinhood]: 120000n,
}

const defaultErc20TransferGasLimit = 120_000n

const erc20TransferGasLimit: Record<EvmChain, bigint> = {
  [EvmChain.Ethereum]: defaultErc20TransferGasLimit,
  [EvmChain.Base]: defaultErc20TransferGasLimit,
  [EvmChain.Arbitrum]: defaultErc20TransferGasLimit,
  [EvmChain.Polygon]: defaultErc20TransferGasLimit,
  [EvmChain.Optimism]: defaultErc20TransferGasLimit,
  [EvmChain.CronosChain]: defaultErc20TransferGasLimit,
  [EvmChain.Blast]: defaultErc20TransferGasLimit,
  [EvmChain.BSC]: defaultErc20TransferGasLimit,
  [EvmChain.Avalanche]: defaultErc20TransferGasLimit,
  [EvmChain.Zksync]: zkSyncTransferGasLimit,
  // sdk#1847 review: this entry is NOT reachable for a real Mantle token send - see the
  // `id && chain === EvmChain.Mantle` branch in deriveEvmGasLimit below, which catches every
  // Mantle ERC-20 transfer (memo-less ones included) before it ever falls through to this
  // table lookup. Kept at the shared default only so the Record stays total; if that branch
  // is ever removed, this value would need its own on-chain-measured Mantle floor first, NOT
  // this default (a real Mantle token send needs gas in the hundreds of millions - Mantle's
  // op-geth fee model, per PR #1938 review evidence, e.g. ~215.5M for a mainnet USDT transfer).
  [EvmChain.Mantle]: defaultErc20TransferGasLimit,
  [EvmChain.Hyperliquid]: defaultErc20TransferGasLimit,
  [EvmChain.Sei]: defaultErc20TransferGasLimit,
  [EvmChain.Robinhood]: defaultErc20TransferGasLimit,
}

type DeriveEvmGasLimitInput = {
  coin: CoinKey<EvmChain>
  data?: string
}

export const deriveEvmGasLimit = ({ coin, data }: DeriveEvmGasLimitInput) => {
  const { id, chain } = coin
  // Mantle branch (3_000_000_000n): a SEPARATE hardcoded value for any data-bearing Mantle
  // call (ERC-20 transfers, contract calls, swaps) - getEvmFeeQuote.ts's
  // shouldBufferDataTxGasLimit already special-cases `chain !== EvmChain.Mantle` to skip its
  // 1.5x data-tx buffer specifically because of this value - an existing test
  // ("keeps Mantle swap gas limits at the existing special floor",
  // getEvmFeeQuote.test.ts) pins today's 3_000_000_000n as deliberate.
  if (data) {
    return chain === EvmChain.Mantle ? 3_000_000_000n : 600_000n
  }

  // sdk#1938 review: a token send (`id` set) is ALWAYS a data-bearing ERC-20 `transfer(...)`
  // call on-chain, even when this call site's own `data` param is undefined (per
  // chainSpecific/resolvers/evm.ts's getData(), which only carries swap calldata or an
  // explicit memo - a plain token send leaves it unset). Without this branch a memo-less
  // Mantle token send fell through to `erc20TransferGasLimit[Mantle]`
  // (defaultErc20TransferGasLimit, 120_000n) - catastrophically under the hundreds-of-millions
  // Mantle's op-geth fee model actually charges for a token transfer, which would fail
  // on-chain and burn the fee. Route it through the same 3_000_000_000n floor every other
  // data-bearing Mantle call already gets, rather than inventing a second Mantle-specific
  // constant.
  if (id && chain === EvmChain.Mantle) {
    return 3_000_000_000n
  }

  return (id ? erc20TransferGasLimit : feeCoinTransferGasLimit)[chain]
}
