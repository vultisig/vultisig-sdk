import { fromChainAmountDisplay } from '@vultisig/core-chain/amount/fromChainAmountExact'
import { Chain } from '@vultisig/core-chain/Chain'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { getThorchainLimitOrderBucketKey } from '@vultisig/core-chain/swap/native/limitSwapCancelBucket'
import {
  isModifyLimitSwapMemo,
  parseCancelLimitSwapMemo,
  ParsedLimitSwapCancelMemo,
} from '@vultisig/core-chain/swap/native/limitSwapCancelMemo'
import { getThorchainMemoAssetChain } from '@vultisig/core-chain/swap/native/thorchainMemoAsset'
import { attempt } from '@vultisig/lib-utils/attempt'

import { KeysignPayload } from '../../types/vultisig/keysign/v1/keysign_message_pb'

/** THORChain's fixed point, which both amounts in a cancel memo are expressed in. */
const thorchainDecimals = chainFeeCoin[Chain.THORChain].decimals

export type KeysignLimitSwapCancel = ParsedLimitSwapCancelMemo & {
  /** Home chain of the sold asset, when its prefix is one this SDK can route. */
  sourceChain?: Chain
  /** Home chain of the bought asset, under the same caveat. */
  targetChain?: Chain
  /** The order's deposited amount, as a decimal string in display units. */
  sourceAmountDecimal: string
  /** The order's original minimum-received, as a decimal string in display units. */
  tradeTargetDecimal: string
  /**
   * The advanced-swap-queue bucket this cancel will address, reproduced from the
   * memo. Two orders sharing it are not independently cancellable, so a reviewer
   * holding the vault's open orders can tell whether this cancel is unambiguous.
   */
  bucketKey: string
}

/**
 * Decode the limit order a keysign payload is about to CANCEL, for review.
 *
 * Returns `undefined` for any payload that is not a limit-order cancellation, so
 * a caller can branch on it directly.
 *
 * **This is how a *joining* device reviews a cancellation.** A cancel carries no
 * swap payload on any branch — it is a `MsgDeposit` or a dust transfer to an
 * inbound vault — so a co-signer keying off the swap payload alone sees a send of
 * a trivial amount to an opaque address with an opaque memo, with nothing saying
 * an order is being closed. Worse than uninformative: the visible amount is dust,
 * which reads as harmless while the transaction closes a position.
 *
 * As with placement, the terms come from `keysignPayload.memo` because the memo
 * IS the instruction THORChain executes, so what a reviewer sees cannot disagree
 * with what gets signed — unlike a display field supplied alongside it, which a
 * co-signer has no way to verify.
 *
 * A *retarget* is deliberately not reported here. `m=<` with a non-zero final
 * field re-prices an order rather than closing it, and a reviewer told "this
 * cancels your order" would be approving something else entirely; the parser
 * rejects it and this returns `undefined`.
 */
export const getKeysignLimitSwapCancel = ({
  memo,
}: Pick<KeysignPayload, 'memo'>): KeysignLimitSwapCancel | undefined => {
  if (!isModifyLimitSwapMemo(memo) || !memo) {
    return undefined
  }

  const parsed = attempt(() => parseCancelLimitSwapMemo(memo))
  if ('error' in parsed) {
    return undefined
  }

  const { data: cancel } = parsed

  return {
    ...cancel,
    sourceChain: getThorchainMemoAssetChain(cancel.sourceAsset),
    targetChain: getThorchainMemoAssetChain(cancel.targetAsset),
    sourceAmountDecimal: fromChainAmountDisplay(cancel.sourceAmount, thorchainDecimals),
    tradeTargetDecimal: fromChainAmountDisplay(cancel.tradeTarget, thorchainDecimals),
    bucketKey: getThorchainLimitOrderBucketKey(cancel),
  }
}
