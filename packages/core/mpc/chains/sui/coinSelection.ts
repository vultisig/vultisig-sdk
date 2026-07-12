/**
 * Deterministic Sui coin-object selection (sdk#1132).
 *
 * Port of vultisig-ios#4734 (`SuiConstants.swift` / `SuiCoinType`), Android
 * sibling vultisig-android#3989. In MPC keysign every co-signing device
 * independently recomputes the Sui transaction bytes from the shared payload;
 * the selection here must stay IDENTICAL across iOS / Android / SDK (and
 * therefore Windows + FastVault's server co-signer) or the sighashes diverge
 * and the ceremony fails. Do not change sort keys, tie-breaks, caps, or the
 * gas-pick fallback without coordinating all platforms.
 */

import { SuiCoin } from '../../types/vultisig/keysign/v1/blockchain_specific_pb'

/** Canonical fully-qualified type of the native SUI coin (short address form). */
export const suiNativeCoinType = '0x2::sui::SUI'

/**
 * Upper bound on the coin objects a single send may reference. Sui rejects a
 * transaction whose serialized size exceeds 128 KiB, and a `PaySui` send uses
 * its entire input set as the gas payment — which Sui caps at 256 objects.
 * Staying one under the cap keeps every send safely within both limits.
 */
export const maxSuiInputCoinObjects = 255

/**
 * How many of the largest native SUI objects to embed as gas candidates for a
 * token send. The signer picks one to pay gas; carrying the largest few keeps
 * the payload small while guaranteeing a covering object survives a
 * re-estimated gas budget.
 */
export const suiGasCandidateObjectCount = 5

/**
 * Collapses a package-address segment to `0x` + hex with leading zeros
 * stripped, so `0x0000…0002` and `0x2` compare equal.
 */
const normalizeSuiAddress = (address: string): string => {
  const hex = address.startsWith('0x') ? address.slice(2) : address
  const trimmed = hex.replace(/^0+/, '')
  return `0x${trimmed === '' ? '0' : trimmed}`
}

/**
 * Normalizes a fully-qualified `address::module::struct` coin type for exact
 * comparison: lowercases the whole string and collapses the package-address
 * segment to canonical form. Ticker-substring matching is wrong here — it
 * cannot distinguish `0x2::sui::SUI` from `0x…::xsui::XSUI`.
 */
export const normalizeSuiCoinType = (coinType: string): string => {
  const lowered = coinType.toLowerCase()
  const [addressSegment] = lowered.split(':')
  if (!addressSegment) return lowered
  return normalizeSuiAddress(addressSegment) + lowered.slice(addressSegment.length)
}

/** Whether two fully-qualified coin types refer to the same coin. */
export const suiCoinTypesMatch = (a: string, b: string): boolean => normalizeSuiCoinType(a) === normalizeSuiCoinType(b)

/** Whether the given coin-object type is the native SUI coin. */
export const isNativeSuiCoinType = (coinType: string): boolean => suiCoinTypesMatch(coinType, suiNativeCoinType)

/** Parses a coin object's balance (base-unit MIST), unparseable = zero. */
export const suiCoinBalance = (coin: SuiCoin): bigint => {
  try {
    return BigInt(coin.balance || '0')
  } catch {
    return BigInt(0)
  }
}

/**
 * Selects the fewest coin objects (largest balance first) that together cover
 * `target`, bounded by `maxObjects`.
 *
 * Selection is deterministic (balance descending, then `coinObjectId`
 * ascending) so every co-signing device selects the identical set and signs
 * the identical transaction. If even `maxObjects` largest objects don't reach
 * `target`, they are still returned (best effort) — the caller decides how to
 * handle an under-funded selection.
 */
export const selectSuiInputCoins = (
  coins: SuiCoin[],
  target: bigint,
  maxObjects: number = maxSuiInputCoinObjects
): SuiCoin[] => {
  const sorted = [...coins].sort((lhs, rhs) => {
    const lhsBalance = suiCoinBalance(lhs)
    const rhsBalance = suiCoinBalance(rhs)
    if (lhsBalance !== rhsBalance) return lhsBalance > rhsBalance ? -1 : 1
    return lhs.coinObjectId < rhs.coinObjectId ? -1 : lhs.coinObjectId > rhs.coinObjectId ? 1 : 0
  })

  const selected: SuiCoin[] = []
  let accumulated = BigInt(0)
  for (const coin of sorted) {
    // Always keep at least one object so a zero/near-zero-amount send still
    // has an input; otherwise stop once the target is covered.
    if (selected.length > 0 && accumulated >= target) break
    if (selected.length >= maxObjects) break
    selected.push(coin)
    accumulated += suiCoinBalance(coin)
  }
  return selected
}

/**
 * Selects the native SUI coin object that pays gas for a token (non-native)
 * send. WalletCore's `Sui.Pay` message carries a *single* `gas` object (unlike
 * `PaySui`, whose whole input set is gas-smashed), so the choice matters:
 * picking an arbitrary object fails when its balance can't cover the budget,
 * even though the wallet holds plenty of SUI across other objects.
 *
 * Choose the *smallest* native SUI object whose balance already covers
 * `gasBudget`; when no single object covers it, fall back to the largest
 * object (best effort — strictly better than an arbitrary pick). Returns
 * `undefined` only when the wallet holds no native SUI object at all.
 * Tie-breaks mirror Swift's `min(by:)` (first minimal) / `max(by:)` (last
 * maximal) over the payload's coin order.
 */
export const selectSuiGasObject = (coins: SuiCoin[], gasBudget: bigint): SuiCoin | undefined => {
  const suiObjects = coins.filter(coin => isNativeSuiCoinType(coin.coinType))
  if (suiObjects.length === 0) return undefined

  let smallestCovering: SuiCoin | undefined
  for (const coin of suiObjects) {
    if (suiCoinBalance(coin) < gasBudget) continue
    if (!smallestCovering || suiCoinBalance(coin) < suiCoinBalance(smallestCovering)) {
      smallestCovering = coin
    }
  }
  if (smallestCovering) return smallestCovering

  let largest = suiObjects[0]
  for (const coin of suiObjects) {
    if (!(suiCoinBalance(coin) < suiCoinBalance(largest))) largest = coin
  }
  return largest
}

/**
 * The minimal set of coin objects to embed in the keysign payload for a Sui
 * send — exactly what the signing-input resolver will consume. Unbounded
 * embedding on a dusty wallet produces a keysign payload too large to relay
 * (co-signer poll 404 / "data expired") and, at signing, a transaction over
 * Sui's size limits.
 *
 * Native send: the largest objects covering `amount + gasBudget` (the input
 * set also pays gas). Token send: the largest token objects covering `amount`,
 * plus the largest few native SUI objects as gas candidates.
 */
export const selectSuiPayloadCoins = ({
  coins,
  contractAddress,
  amount,
  gasBudget,
}: {
  coins: SuiCoin[]
  /** The token's fully-qualified type; empty for a native SUI send. */
  contractAddress: string
  amount: bigint
  gasBudget: bigint
}): SuiCoin[] => {
  const nativeObjects = coins.filter(coin => isNativeSuiCoinType(coin.coinType))

  if (!contractAddress) {
    return selectSuiInputCoins(nativeObjects, amount + gasBudget)
  }

  const tokenObjects = coins.filter(coin => suiCoinTypesMatch(coin.coinType, contractAddress))
  const selectedTokens = selectSuiInputCoins(tokenObjects, amount)
  const gasCandidates = [...nativeObjects]
    .sort((lhs, rhs) => {
      const lhsBalance = suiCoinBalance(lhs)
      const rhsBalance = suiCoinBalance(rhs)
      if (lhsBalance !== rhsBalance) return lhsBalance > rhsBalance ? -1 : 1
      return 0
    })
    .slice(0, suiGasCandidateObjectCount)
  return [...selectedTokens, ...gasCandidates]
}
