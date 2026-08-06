import { fromChainAmountDisplay } from '@vultisig/core-chain/amount/fromChainAmountExact'
import { Chain } from '@vultisig/core-chain/Chain'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import {
  limitSwapExpiryHours,
  LimitSwapExpiryHours,
  getLimitSwapIntervalBlocks,
  limitSwapMemoPrefix,
  ParsedLimitSwapMemo,
  parseLimitSwapMemo,
} from '@vultisig/core-chain/swap/native/limitSwapMemo'
import { thorchainAssetPrefixToChain } from '@vultisig/core-chain/swap/native/thorchainMemoAsset'
import { attempt } from '@vultisig/lib-utils/attempt'

import { KeysignPayload } from '../../types/vultisig/keysign/v1/keysign_message_pb'

/** THORChain's fixed point for pool amounts, which the memo's LIM is expressed in. */
const thorchainDecimals = chainFeeCoin[Chain.THORChain].decimals

const intervalBlocksToExpiryHours: Readonly<Partial<Record<number, LimitSwapExpiryHours>>> = Object.freeze(
  Object.fromEntries(limitSwapExpiryHours.map(hours => [getLimitSwapIntervalBlocks(hours), hours]))
)

export type KeysignLimitSwapOrder = ParsedLimitSwapMemo & {
  /** The buy chain, when the target asset's prefix is one this SDK can route. */
  targetChain?: Chain
  /**
   * Guaranteed-minimum received, as a decimal string in the target asset's
   * display units. Formatted from the LIM with THORChain's 8 decimals, matching
   * how `toAmountDecimal` is formatted for market swaps.
   */
  minimumReceivedDecimal: string
  /** The order's resting lifetime, when the interval maps to one this SDK builds. */
  expiryHours?: LimitSwapExpiryHours
}

/**
 * Decode the limit order a keysign payload is about to place, for review.
 *
 * Returns `undefined` for any payload that is not a limit order, so a caller can
 * branch on it directly.
 *
 * **This is how a *joining* device reviews a limit order.** The builder attaches
 * a `swapPayload` only for ERC20 sources — RUNE and native-gas-asset orders are
 * plain deposits — so a co-signer keying off the swap payload alone sees a
 * generic send to an opaque address with an opaque memo, and cannot tell what is
 * being bought, where it pays out, or at what floor.
 *
 * Deriving the terms from `keysignPayload.memo` fixes that uniformly, because
 * the memo is present on every source branch. It is also the *only* trustworthy
 * source: the memo is the exact string THORChain executes, so terms read from it
 * cannot disagree with the order that gets signed. A display field carried
 * alongside the memo can — it is supplied by the initiating device, and a
 * co-signer has no way to tell a mistaken one from a malicious one.
 *
 * Parsing is fail-closed on a malformed memo, but a caller reviewing an
 * arbitrary payload wants "not a limit order" rather than a throw, so a memo
 * that does not parse is reported as not-a-limit-order. Signing still rejects it:
 * `buildLimitSwapKeysignPayload` parses the same memo and throws.
 */
export const getKeysignLimitSwapOrder = ({ memo }: Pick<KeysignPayload, 'memo'>): KeysignLimitSwapOrder | undefined => {
  if (!memo?.startsWith(limitSwapMemoPrefix)) {
    return undefined
  }

  const parsed = attempt(() => parseLimitSwapMemo(memo))
  if ('error' in parsed) {
    return undefined
  }

  const { data: order } = parsed

  return {
    ...order,
    targetChain: thorchainAssetPrefixToChain[order.targetAsset.split('.')[0].toUpperCase()],
    minimumReceivedDecimal: fromChainAmountDisplay(order.limit, thorchainDecimals),
    expiryHours: intervalBlocksToExpiryHours[order.intervalBlocks],
  }
}
