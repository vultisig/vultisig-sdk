import {
  buildCancelLimitSwapMemo,
  doesCancelLimitSwapMemoFit,
  isAbbreviatedThorchainMemoAsset,
  LimitSwapCancelInputs,
} from './limitSwapCancelMemo'
import { getLimitSwapSourceChainKind, LimitSwapSourceChainKind } from './limitSwapMemo'

export const limitSwapCancelBlockers = [
  /** The order has already closed. Nothing left to cancel. */
  'terminal',
  /**
   * A cancel for this order has already been broadcast and is waiting to be
   * observed. Without this, a user could pay the fee (and on L1 donate the
   * dust) again for an identical memo landing in the identical bucket.
   */
  'cancelAlreadyBroadcast',
  /**
   * The order predates the fields cancelling needs, or no source can supply an
   * asset's full spelling. Fails closed rather than guessing at the values the
   * matcher keys on.
   */
  'missingSignedData',
  /**
   * What was recorded at signing and what the queue reports disagree. One of
   * them is wrong and there is no way to tell which, so neither is signed.
   */
  'signedDataDisagreesWithChain',
  /**
   * The cancel memo does not fit the source chain's per-transaction budget —
   * in practice an ERC20 target from a UTXO source. Nothing in a cancel memo
   * can be shortened, so the order simply refunds at expiry instead.
   */
  'memoTooLongForSourceChain',
  /**
   * The source asset names a chain THORChain cannot route, so there is no
   * inbound vault to send the cancel to and no byte budget to size it against.
   */
  'unroutableSourceChain',
] as const

export type LimitSwapCancelBlocker = (typeof limitSwapCancelBlockers)[number]

/**
 * Which spelling of an asset a cancel memo may use, or why there isn't one.
 */
export type LimitSwapCancelAssetResolution = { resolved: string } | { problem: 'disagrees' } | { problem: 'unknown' }

type ResolveLimitSwapCancelAssetInput = {
  /** The PLACEMENT memo's spelling — lossy, usable only when not truncated. */
  stored: string
  /** The full form captured locally at signing, when it exists. */
  signed?: string
  /** The queue's own report, after `fuzzyAssetMatch` resolved the placement. */
  observed?: string
}

const trimmed = (value: string | undefined): string | undefined => {
  const text = value?.trim()
  return text ? text : undefined
}

/**
 * Resolve which spelling of one of the order's assets a cancel may use.
 *
 * Three sources, in decreasing order of how much they prove:
 *
 * 1. **The queue's own report** — the string THORChain built this order's index
 *    entry from. Authoritative by construction, and the only source for an
 *    order placed before the full form was recorded locally.
 * 2. **The full form captured at signing** — derived from the coin's own
 *    contract, so exact whenever it exists.
 * 3. **The stored placement spelling** — usable ONLY when it carries no
 *    truncated identifier, which makes it full by construction. That covers
 *    every native leg (`BTC.BTC`, `THOR.RUNE`) and every secured denom.
 *
 * `disagrees` when a local spelling and the chain's own differ: one is wrong
 * and there is no way to tell which. This is the check a real failure needed —
 * the amounts were cross-checked and agreed, the assets were never compared,
 * and the asset was the entire defect.
 *
 * Compared case-insensitively: the sources differ on case by convention (a
 * secured denom is emitted lower-case and reported upper-case, and
 * `common.ParseCoin` upper-cases whatever it is given). Anything beyond case is
 * a real difference.
 */
export const resolveLimitSwapCancelAsset = ({
  stored,
  signed,
  observed,
}: ResolveLimitSwapCancelAssetInput): LimitSwapCancelAssetResolution => {
  const storedIfUsable = isAbbreviatedThorchainMemoAsset(stored) ? undefined : trimmed(stored)
  const local = trimmed(signed) ?? storedIfUsable
  const chain = trimmed(observed)

  if (!chain) {
    return local ? { resolved: local } : { problem: 'unknown' }
  }
  if (!local) {
    // No local spelling to check against — the legacy token case, rescued by
    // the only source still holding the full contract.
    return { resolved: chain }
  }
  if (local.toLowerCase() !== chain.toLowerCase()) {
    return { problem: 'disagrees' }
  }
  // Proven equal bar case, so the local spelling is kept: it is the exact byte
  // form this SDK derived.
  return { resolved: local }
}

export type LimitSwapCancelCandidate = {
  /** Whether the order has already closed. */
  isTerminal: boolean
  /** Whether a cancel has already been broadcast against this order. */
  hasPendingCancel?: boolean
  /** Source asset as the PLACEMENT memo spelled it. */
  sourceAsset: string
  /** Target asset as the PLACEMENT memo spelled it. */
  targetAsset: string
  /** Full source spelling captured at signing, if recorded. */
  signedSourceAsset?: string
  /** Full target spelling captured at signing, if recorded. */
  signedTargetAsset?: string
  /** Deposited source amount recorded at signing, in 1e8. */
  signedSourceAmount?: bigint
  /** Trade target recorded at signing, in 1e8. */
  signedTradeTarget?: bigint
  /** The queue's `coins[0].asset`, once polled. */
  observedSourceAsset?: string
  /** The queue's `target_asset`, once polled. */
  observedTargetAsset?: string
  /** The queue's `state.deposit`, once polled. */
  observedDeposit?: bigint
  /** The queue's `trade_target`, once polled. */
  observedTradeTarget?: bigint
}

export type LimitSwapCancelEligibility = { cancellable: LimitSwapCancelInputs } | { blocked: LimitSwapCancelBlocker }

/**
 * Decide whether an order can be cancelled, and if so with which exact amounts.
 *
 * **Fails closed at every unknown.** The failure this guards against is not a
 * crash or an error dialog — it is a cancel that is accepted, costs a fee, and
 * silently matches no order at all. Every branch that cannot prove the values
 * are the ones THORChain holds returns a blocker.
 *
 * The signed-versus-observed cross-check covers assets as well as amounts.
 * Absence is NOT disagreement: an order placed seconds ago has not been polled,
 * and refusing to cancel until the first poll lands would be a worse failure
 * than the one this prevents. But present-and-unparseable blocks exactly as a
 * mismatch does — "not polled yet" and "polled, and the wire carried something
 * we do not model" are different claims, and only the first is safe to proceed
 * through.
 */
export const getLimitSwapCancelEligibility = (candidate: LimitSwapCancelCandidate): LimitSwapCancelEligibility => {
  if (candidate.isTerminal) {
    return { blocked: 'terminal' }
  }
  if (candidate.hasPendingCancel) {
    return { blocked: 'cancelAlreadyBroadcast' }
  }

  const { signedSourceAmount, signedTradeTarget } = candidate
  if (
    signedSourceAmount === undefined ||
    signedTradeTarget === undefined ||
    signedSourceAmount <= 0n ||
    signedTradeTarget <= 0n
  ) {
    return { blocked: 'missingSignedData' }
  }

  // `state.deposit` IS the swap's `Tx.Coins[0].Amount` and `trade_target` IS
  // `msg.TradeTarget` — the exact pair the matcher's ratio is computed from.
  if (candidate.observedDeposit !== undefined && candidate.observedDeposit !== signedSourceAmount) {
    return { blocked: 'signedDataDisagreesWithChain' }
  }
  if (candidate.observedTradeTarget !== undefined && candidate.observedTradeTarget !== signedTradeTarget) {
    return { blocked: 'signedDataDisagreesWithChain' }
  }

  const source = resolveLimitSwapCancelAsset({
    stored: candidate.sourceAsset,
    signed: candidate.signedSourceAsset,
    observed: candidate.observedSourceAsset,
  })
  const target = resolveLimitSwapCancelAsset({
    stored: candidate.targetAsset,
    signed: candidate.signedTargetAsset,
    observed: candidate.observedTargetAsset,
  })

  if (!('resolved' in source) || !('resolved' in target)) {
    const disagrees =
      ('problem' in source && source.problem === 'disagrees') || ('problem' in target && target.problem === 'disagrees')
    return { blocked: disagrees ? 'signedDataDisagreesWithChain' : 'missingSignedData' }
  }

  const inputs: LimitSwapCancelInputs = {
    sourceAsset: source.resolved,
    sourceAmount: signedSourceAmount,
    targetAsset: target.resolved,
    tradeTarget: signedTradeTarget,
  }

  // The memo must be buildable AND fit the chain it will be sent from. Checked
  // here rather than at signing so the action is never offered for an order
  // that cannot actually be cancelled.
  let memo: string
  try {
    memo = buildCancelLimitSwapMemo(inputs)
  } catch {
    return { blocked: 'missingSignedData' }
  }

  // Resolved in its own guarded step: the memo builder does not check
  // routability, so an unrecognised prefix reaches this call and throws —
  // escaping a function whose whole contract is to answer with a blocker.
  let sourceChainKind: LimitSwapSourceChainKind
  try {
    sourceChainKind = getLimitSwapSourceChainKind(inputs.sourceAsset)
  } catch {
    return { blocked: 'unroutableSourceChain' }
  }

  if (!doesCancelLimitSwapMemoFit(memo, sourceChainKind)) {
    return { blocked: 'memoTooLongForSourceChain' }
  }

  return { cancellable: inputs }
}
