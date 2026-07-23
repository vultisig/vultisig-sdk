import { Chain } from '../../Chain'
import { ThorchainInboundAddress } from '../../chains/cosmos/thor/getThorchainInboundAddress'
import { thorchainMemoAssetChainPrefix } from './thorchainMemoAsset'

/**
 * Whether an inbound row is usable right now.
 *
 * Missing pause flags read as "not paused", matching the market swap's halt gate.
 * The vault address must also be present: it becomes the deposit's `toAddress`,
 * and an empty one would sign funds to nowhere.
 */
const isTradeable = ({
  address,
  halted,
  global_trading_paused,
  chain_trading_paused,
}: ThorchainInboundAddress): boolean =>
  Boolean(address?.trim()) && !halted && !global_trading_paused && !chain_trading_paused

/**
 * Whether THORChain has globally paused trading, per a live `inbound_addresses`
 * list. THORChain sets `global_trading_paused` on every inbound row when it halts
 * network-wide.
 */
export const isThorchainGloballyPaused = (inbounds: ThorchainInboundAddress[]): boolean =>
  inbounds.some(({ global_trading_paused }) => global_trading_paused)

/**
 * Whether a native RUNE `MsgDeposit` must be blocked given the live inbound list.
 *
 * RUNE settles on THORChain itself with no inbound vault, so it never passes
 * through the per-chain halt filter an external source does — this global signal
 * is its gate. Blocks on an empty list too: a real `inbound_addresses` response
 * always carries many rows, so an empty (but non-throwing) result means the pause
 * state is unverifiable and a deposit must not be signed against it.
 */
export const shouldBlockRuneDeposit = (inbounds: ThorchainInboundAddress[]): boolean =>
  inbounds.length === 0 || isThorchainGloballyPaused(inbounds)

type IsLimitSwapDestinationHaltedInput = {
  inbounds: ThorchainInboundAddress[]
  chain: Chain
}

/**
 * Whether a limit order's destination chain is halted or trading-paused, per the
 * live inbound list.
 *
 * The market path re-checks both route legs at broadcast through the native swap
 * payload, but a RUNE `MsgDeposit` never carries one — this sign-time gate is
 * its only destination check. Mirrors the broadcast guard's tolerance: a leg
 * with no memo prefix or no inbound row (THORChain-native assets; the feed lists
 * no row for THORChain itself) is not haltable via this feed and reads as live.
 */
export const isLimitSwapDestinationHalted = ({ inbounds, chain }: IsLimitSwapDestinationHaltedInput): boolean => {
  const chainSymbol = thorchainMemoAssetChainPrefix[chain]
  if (!chainSymbol) {
    return false
  }

  const inbound = inbounds.find(entry => entry.chain.trim().toUpperCase() === chainSymbol)

  return Boolean(inbound && (inbound.halted || inbound.global_trading_paused || inbound.chain_trading_paused))
}

type FindLimitSwapInboundInput = {
  inbounds: ThorchainInboundAddress[]
  chain: Chain
}

/**
 * Select the live, tradeable inbound row a limit-swap deposit should target.
 *
 * Resolves the chain through the same prefix table the memo builder uses, so a
 * source the memo could not encode can never resolve an inbound. Throws rather
 * than returning undefined: every caller is about to sign a value-bearing
 * deposit, and there is no safe fallback for "no usable vault".
 */
export const findLimitSwapInbound = ({ inbounds, chain }: FindLimitSwapInboundInput): ThorchainInboundAddress => {
  const chainSymbol = thorchainMemoAssetChainPrefix[chain]
  if (!chainSymbol) {
    throw new Error(`findLimitSwapInbound: ${chain} is not routable through THORChain`)
  }

  const inbound = inbounds.find(entry => entry.chain.trim().toUpperCase() === chainSymbol && isTradeable(entry))

  if (!inbound) {
    throw new Error(
      `findLimitSwapInbound: no live, tradeable THORChain inbound address for ${chainSymbol}. ` +
        'The chain may be halted or trading-paused.'
    )
  }

  return inbound
}
