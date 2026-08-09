import { fromBech32 } from '@cosmjs/encoding'
import { PublicKey } from '@solana/web3.js'

import { Chain } from '../../Chain'
import { getChainKind } from '../../ChainKind'
import { baseAffiliateBps } from '../affiliate/config'
import { nativeSwapAffiliateConfig } from './nativeSwapAffiliateConfig'
import { getThorchainMemoAssetChain, thorchainAssetPrefixToChain } from './thorchainMemoAsset'

export const limitSwapExpiryHours = [12, 24, 72] as const
export type LimitSwapExpiryHours = (typeof limitSwapExpiryHours)[number]

export type LimitSwapNumericInput = bigint | number | string

export type LimitSwapMemoInput = {
  source_asset: string
  source_amount: LimitSwapNumericInput
  target_asset: string
  dest_addr: string
  target_price: LimitSwapNumericInput
  expiry_hours: LimitSwapExpiryHours
}

export type LimitSwapSourceChainKind = 'utxo' | 'other'

export const limitSwapMemoByteLimit: Record<LimitSwapSourceChainKind, number> = {
  utxo: 80,
  other: 250,
}

const priceScale = 100_000_000n

const expiryHoursToIntervalBlocks: Record<LimitSwapExpiryHours, number> = {
  12: 7_200,
  24: 14_400,
  72: 43_200,
}

const assertMemoSegmentSafe = (value: string, fieldName: string): void => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`)
  }
  if (value.includes(':') || value.includes('/')) {
    throw new Error(`${fieldName} must not contain memo separators ":" or "/"`)
  }
  if (/\s/.test(value)) {
    throw new Error(`${fieldName} must not contain whitespace`)
  }
  if (!/^[\x21-\x7E]+$/.test(value)) {
    throw new Error(`${fieldName} must contain printable ASCII characters only`)
  }
}

const getAssetChainPrefix = (asset: string): string => {
  const [prefix] = asset.split('.')
  return prefix
}

/** `CHAIN.TICKER` or `CHAIN.TICKER-CONTRACT` — a layer-1 pool asset. */
const layer1LimitSwapAssetPattern = /^[A-Z0-9]+\.[A-Z0-9]+(-[A-Z0-9]+)?$/

/**
 * A THORChain SECURED denom: `<l1chain>-<symbol>` (`btc-btc`, `xrp-xrp`) or
 * `<l1chain>-<symbol>-<contract>` (`eth-usdc-0xa0b…`).
 *
 * Case-insensitive on purpose: this app emits the denom lower-case, THORNode's
 * `common.ParseAsset` upper-cases whatever it is given, and the queue reports it
 * back upper-cased. All three spell the same asset.
 */
const securedLimitSwapAssetPattern = /^[A-Za-z0-9]+-[A-Za-z0-9]+(-[A-Za-z0-9]+)?$/

/**
 * The chain a limit-swap asset must be SENT FROM (as a source) or PAID OUT ON
 * (as a target) — `Asset.GetChain()` on THORNode's side.
 *
 * Two notations are accepted, and the discriminator is simply whether the asset
 * carries a `.`:
 *
 * - **Layer-1** (`BTC.BTC`, `ETH.USDC-0XA0B8…`) — resolves to its own chain.
 *   The deposit arrives at that chain's Asgard inbound, and a payout leaves to
 *   an address on it.
 * - **Secured** (`eth-usdc-0xa0b…`, `xrp-xrp`) — resolves to **THORChain**. A
 *   secured asset originates elsewhere but is custodied on THORChain, so it is
 *   deposited by `MsgDeposit` from a THOR address and paid out to one. Reading
 *   its home chain here would send the deposit to an Ethereum vault and validate
 *   the payout address as an Ethereum one — both wrong.
 *
 * Deliberately NOT `assertValidPoolId`: that validator is the shared THORChain
 * *pool id* grammar, used by the LP paths, and it only knows dotted notation.
 * Widening it would change what every one of those callers accepts. A limit swap
 * needs its own, narrower question — "is this an asset THIS memo can carry" —
 * so it gets its own validator.
 *
 * Synths (`BTC/BTC`) and trade assets (`ETH~ETH`) remain unsupported. They are a
 * different custody model again, and neither has been verified against the
 * advanced swap queue, so they fail here rather than building a memo whose
 * behaviour nobody has established.
 */
const getSupportedThorchainAssetChain = (asset: string, fieldName: string): Chain => {
  const normalized = typeof asset === 'string' ? asset.trim() : ''
  if (!normalized) {
    throw new Error(`${fieldName} must be a non-empty THORChain asset`)
  }
  if (normalized !== asset) {
    throw new Error(`${fieldName} must not contain surrounding whitespace`)
  }

  if (normalized.includes('.')) {
    if (!layer1LimitSwapAssetPattern.test(normalized)) {
      throw new Error(
        `${fieldName} is not a valid THORChain layer-1 asset: ${JSON.stringify(asset)}. ` +
          `Expected uppercase CHAIN.ASSET (e.g. "BTC.BTC") or CHAIN.ASSET-CONTRACT.`
      )
    }

    const prefix = getAssetChainPrefix(normalized)
    const chain = thorchainAssetPrefixToChain[prefix.toUpperCase()]
    if (!chain) {
      throw new Error(`${fieldName} has unsupported THORChain asset prefix: ${prefix}`)
    }
    return chain
  }

  if (!securedLimitSwapAssetPattern.test(normalized)) {
    throw new Error(
      `${fieldName} is not a THORChain asset this memo can carry: ${JSON.stringify(asset)}. ` +
        `Expected a layer-1 asset (e.g. "BTC.BTC") or a secured denom (e.g. "eth-usdc-0xa0b…"). ` +
        `Synth and trade assets are not supported.`
    )
  }

  // The denom's leading segment is its ORIGIN chain, which must be one THORChain
  // routes — `nope-nope` is a well-shaped string naming nothing.
  if (!getThorchainMemoAssetChain(normalized)) {
    throw new Error(
      `${fieldName} names a secured asset whose origin chain THORChain cannot route: ${JSON.stringify(asset)}`
    )
  }

  // Custodied on THORChain, wherever it came from.
  return Chain.THORChain
}

const parsePositiveInteger = (value: LimitSwapNumericInput, fieldName: string): bigint => {
  if (typeof value === 'bigint') {
    if (value > 0n) return value
    throw new Error(`${fieldName} must be greater than 0`)
  }

  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value > 0) return BigInt(value)
    throw new Error(`${fieldName} must be a positive safe integer`)
  }

  const normalized = value.trim()
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error(`${fieldName} must be a positive integer string`)
  }
  return BigInt(normalized)
}

const parsePositiveDecimal = (value: LimitSwapNumericInput, fieldName: string): bigint => {
  if (typeof value === 'bigint') {
    if (value > 0n) return value * priceScale
    throw new Error(`${fieldName} must be greater than 0`)
  }

  let normalized: string
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${fieldName} must be greater than 0`)
    }
    normalized = value.toString()
    if (normalized.includes('e')) {
      normalized = value.toFixed(8)
    }
    if (Number(normalized) !== value) {
      throw new Error(`${fieldName} must be a positive decimal with at most 8 fractional digits`)
    }
  } else {
    normalized = value.trim()
  }

  const match = normalized.match(/^(\d+)(?:\.(\d{1,8})?)?$/)
  if (!match) {
    throw new Error(`${fieldName} must be a positive decimal with at most 8 fractional digits`)
  }

  const [, whole, fractional = ''] = match
  const scaled = BigInt(whole) * priceScale + BigInt(fractional.padEnd(8, '0'))
  if (scaled <= 0n) {
    throw new Error(`${fieldName} must be greater than 0`)
  }
  return scaled
}

export const getLimitSwapSourceChainKind = (sourceAsset: string): LimitSwapSourceChainKind => {
  const chain = getSupportedThorchainAssetChain(sourceAsset, 'source_asset')
  return getChainKind(chain) === 'utxo' ? 'utxo' : 'other'
}

export const getLimitSwapIntervalBlocks = (expiryHours: LimitSwapExpiryHours): number => {
  const interval = expiryHoursToIntervalBlocks[expiryHours]
  if (!interval) {
    throw new Error(`expiry_hours must be one of ${limitSwapExpiryHours.join(', ')}, got ${expiryHours}`)
  }
  return interval
}

export const getLimitSwapLimitAmount = ({
  source_amount,
  target_price,
}: Pick<LimitSwapMemoInput, 'source_amount' | 'target_price'>): bigint => {
  const sourceAmount = parsePositiveInteger(source_amount, 'source_amount')
  const targetPrice = parsePositiveDecimal(target_price, 'target_price')

  const limit = (sourceAmount * targetPrice) / priceScale

  if (limit === 0n) {
    // THORChain treats a zero trade target (LIM) in a limit-swap memo as an
    // unprotected market order. source_amount/target_price combinations
    // that floor to 0 here can't be honestly expressed as a limit order at
    // this price scale, so we fail closed instead of silently reinterpreting
    // the user's price-protected limit swap as a market swap.
    throw new Error(
      'source_amount and target_price combination is too small to express as a limit swap: ' +
        'the computed minimum-received amount (LIM) floors to 0, which THORChain treats as an ' +
        'unprotected market order. Increase source_amount or target_price.'
    )
  }

  return limit
}

export const assertMemoByteLength = (memo: string, sourceChainKind: LimitSwapSourceChainKind): void => {
  const limit = limitSwapMemoByteLimit[sourceChainKind]
  if (!limit) {
    throw new Error(`Unknown source chain kind: ${sourceChainKind}`)
  }

  const byteLength = new TextEncoder().encode(memo).length
  if (byteLength > limit) {
    throw new Error(`THORChain limit swap memo is ${byteLength} bytes, exceeding ${sourceChainKind} limit ${limit}`)
  }
}

const base58AddressChars = '1-9A-HJ-NP-Za-km-z'

const isBech32Address = (address: string, prefix: string): boolean => {
  try {
    const decoded = fromBech32(address)
    return decoded.prefix === prefix && decoded.data.length > 0
  } catch {
    return false
  }
}

const isEvmAddress = (address: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(address)

const isSolanaAddress = (address: string): boolean => {
  if (!new RegExp(`^[${base58AddressChars}]{32,44}$`).test(address)) {
    return false
  }
  try {
    return new PublicKey(address).toBytes().length === 32
  } catch {
    return false
  }
}

type LimitSwapDestinationValidator = (address: string) => boolean

// Keep this exhaustive even though unsupported chains deliberately map to
// `undefined`: adding a Chain must force an explicit decision about whether
// THORChain limit swaps can safely validate destinations for it.
const limitSwapDestinationValidators: Record<Chain, LimitSwapDestinationValidator | undefined> = {
  [Chain.Arbitrum]: isEvmAddress,
  [Chain.Base]: isEvmAddress,
  [Chain.Blast]: undefined,
  [Chain.Optimism]: undefined,
  [Chain.Zksync]: undefined,
  [Chain.Mantle]: undefined,
  [Chain.Robinhood]: undefined,
  [Chain.Avalanche]: isEvmAddress,
  [Chain.CronosChain]: undefined,
  [Chain.BSC]: isEvmAddress,
  [Chain.Ethereum]: isEvmAddress,
  [Chain.Polygon]: undefined,
  [Chain.Hyperliquid]: undefined,
  [Chain.Sei]: undefined,

  [Chain.Bitcoin]: address =>
    new RegExp(`^(bc1[ac-hj-np-z02-9]{11,71}|[13][${base58AddressChars}]{25,34})$`, 'i').test(address),
  [Chain.BitcoinCash]: address =>
    new RegExp(`^([qp][0-9a-z]{41}|[13][${base58AddressChars}]{25,34})$`, 'i').test(address),
  [Chain.Dash]: address => new RegExp(`^X[${base58AddressChars}]{33}$`).test(address),
  [Chain.Dogecoin]: address => new RegExp(`^D[5-9A-HJ-NP-U][${base58AddressChars}]{32}$`).test(address),
  [Chain.Litecoin]: address =>
    new RegExp(`^(ltc1[ac-hj-np-z02-9]{11,71}|[LM3][${base58AddressChars}]{25,34})$`, 'i').test(address),
  [Chain.Zcash]: address => new RegExp(`^t[13][${base58AddressChars}]{33}$`).test(address),

  [Chain.Cosmos]: address => isBech32Address(address, 'cosmos'),
  [Chain.Osmosis]: undefined,
  [Chain.Dydx]: undefined,
  [Chain.Kujira]: address => isBech32Address(address, 'kujira'),
  [Chain.Terra]: undefined,
  [Chain.TerraClassic]: undefined,
  [Chain.Noble]: address => isBech32Address(address, 'noble'),
  [Chain.Akash]: undefined,
  [Chain.THORChain]: address => isBech32Address(address, 'thor'),
  [Chain.MayaChain]: undefined,

  [Chain.Sui]: undefined,
  [Chain.Solana]: isSolanaAddress,
  [Chain.Polkadot]: undefined,
  [Chain.Bittensor]: undefined,
  [Chain.Ton]: undefined,
  [Chain.Ripple]: address => new RegExp(`^r[${base58AddressChars}]{24,34}$`).test(address),
  [Chain.Tron]: address => new RegExp(`^T[${base58AddressChars}]{33}$`).test(address),
  [Chain.Cardano]: undefined,
  [Chain.QBTC]: undefined,
}

const assertValidLimitSwapDestinationAddress = (targetChain: Chain, address: string): void => {
  const validator = limitSwapDestinationValidators[targetChain]
  if (!validator) {
    throw new Error(`target_asset chain ${targetChain} is not supported for limit swap destinations`)
  }
  if (!validator(address)) {
    throw new Error(`dest_addr is not a valid ${targetChain} address`)
  }
}

const assertValidLimitSwapDestination = (targetAsset: string, address: string): void => {
  const targetChain = getSupportedThorchainAssetChain(targetAsset, 'target_asset')
  assertMemoSegmentSafe(address, 'dest_addr')
  assertValidLimitSwapDestinationAddress(targetChain, address)
}

export const validateLimitSwapInputs = (inputs: LimitSwapMemoInput): void => {
  getSupportedThorchainAssetChain(inputs.source_asset, 'source_asset')
  assertValidLimitSwapDestination(inputs.target_asset, inputs.dest_addr)

  parsePositiveInteger(inputs.source_amount, 'source_amount')
  parsePositiveDecimal(inputs.target_price, 'target_price')
  getLimitSwapIntervalBlocks(inputs.expiry_hours)
}

/**
 * THORChain memo prefix selecting the advanced swap queue — what makes a deposit
 * a resting limit order rather than a market swap (`=>`).
 */
export const limitSwapMemoPrefix = '=<:'

/** `<LIM>/<interval>/<quantity>`, the segment that makes the order a limit order. */
const limitSwapMemoTradeTargetPattern = /^\d+\/\d+\/\d+$/

/** Basis points are a bare integer; the affiliate name is a printable, separator-free token. */
const limitSwapMemoAffiliateBpsPattern = /^\d+$/

/** The order terms a `=<` memo encodes, as decoded from the memo itself. */
export type ParsedLimitSwapMemo = {
  /** THORChain asset notation for the buy side, e.g. `ETH.USDC-06EB48`. */
  targetAsset: string
  /** Where a filled order pays out. */
  destinationAddress: string
  /** Guaranteed-minimum received (LIM), in THORChain's 1e8 fixed point. */
  limit: bigint
  /** How long the order rests, in THORChain blocks. */
  intervalBlocks: number
  /** Streaming quantity; `0` for the orders this SDK builds. */
  quantity: number
  affiliate?: string
  affiliateBps?: number
}

/**
 * Decode a THORChain limit-swap memo into the order terms it encodes.
 *
 * Fail closed on anything that is not a well-formed limit memo. This guards the
 * signing path: the limit deposit builder accepts a pre-built memo string, so a
 * market (`=>`) memo, an unrelated action, or a truncated/corrupted limit memo
 * would otherwise sign a value-bearing deposit that executes with completely
 * different semantics — or with no price protection at all.
 *
 * Validates the shape `=<:TARGET:DEST:LIM/INTERVAL/QUANTITY[:AFFILIATE:BPS]`
 * rather than only the prefix, because it is the trade-target segment that
 * carries the order's price floor: a memo whose LIM is missing or non-numeric is
 * exactly the case that must never reach a signer.
 *
 * Returning the terms rather than only validating them is what lets a *joining*
 * device review a limit order. The memo is the order — it rides on the keysign
 * payload for every source branch, and it is the exact string THORChain
 * executes — so terms derived from it cannot disagree with what gets signed, the
 * way a separately-supplied display field can.
 */
export const parseLimitSwapMemo = (memo: string): ParsedLimitSwapMemo => {
  if (!memo.startsWith(limitSwapMemoPrefix)) {
    throw new Error(
      `memo is not a THORChain limit-swap memo (expected a "${limitSwapMemoPrefix}" prefix): ${JSON.stringify(memo)}`
    )
  }

  const segments = memo.slice(limitSwapMemoPrefix.length).split(':')
  if (segments.length !== 3 && segments.length !== 5) {
    throw new Error(
      `limit-swap memo must have 3 segments (or 5 with an affiliate) after the prefix, got ${segments.length}: ${JSON.stringify(memo)}`
    )
  }

  const [targetAsset, destAddress, tradeTarget, affiliate, affiliateBps] = segments

  if (!targetAsset) {
    throw new Error(`limit-swap memo is missing its target asset: ${JSON.stringify(memo)}`)
  }

  if (!destAddress) {
    throw new Error(`limit-swap memo is missing its destination address: ${JSON.stringify(memo)}`)
  }

  if (!limitSwapMemoTradeTargetPattern.test(tradeTarget)) {
    throw new Error(
      `limit-swap memo trade target must be "<limit>/<interval>/<quantity>", got ${JSON.stringify(tradeTarget)}`
    )
  }

  const [limit, interval, quantity] = tradeTarget.split('/')
  if (BigInt(limit) === 0n) {
    // THORChain reads a zero trade target as an unprotected market order.
    throw new Error(`limit-swap memo has a zero minimum-received (LIM), which THORChain treats as a market order`)
  }

  if (segments.length === 5) {
    if (!affiliate) {
      throw new Error(`limit-swap memo has an empty affiliate segment: ${JSON.stringify(memo)}`)
    }

    if (!limitSwapMemoAffiliateBpsPattern.test(affiliateBps)) {
      throw new Error(`limit-swap memo affiliate bps must be an integer, got ${JSON.stringify(affiliateBps)}`)
    }
  }

  assertValidLimitSwapDestination(targetAsset, destAddress)

  return {
    targetAsset,
    destinationAddress: destAddress,
    limit: BigInt(limit),
    intervalBlocks: Number(interval),
    quantity: Number(quantity),
    ...(segments.length === 5 ? { affiliate, affiliateBps: Number(affiliateBps) } : {}),
  }
}

/**
 * Fail closed on anything that is not a well-formed THORChain limit-swap memo.
 *
 * Thin wrapper over {@link parseLimitSwapMemo} so the grammar has exactly one
 * implementation — a validator that could drift from the parser is how a memo
 * ends up reviewed as one order and executed as another.
 */
export const assertLimitSwapMemo = (memo: string): void => {
  parseLimitSwapMemo(memo)
}

const buildMemo = (inputs: LimitSwapMemoInput, includeAffiliate: boolean): string => {
  const limit = getLimitSwapLimitAmount(inputs)
  const interval = getLimitSwapIntervalBlocks(inputs.expiry_hours)
  const memo = `${limitSwapMemoPrefix}${inputs.target_asset}:${inputs.dest_addr}:${limit}/${interval}/0`

  return includeAffiliate ? `${memo}:${nativeSwapAffiliateConfig.affiliateFeeAddress}:${baseAffiliateBps}` : memo
}

export const buildLimitSwapMemo = (inputs: LimitSwapMemoInput): string => {
  validateLimitSwapInputs(inputs)

  const sourceChainKind = getLimitSwapSourceChainKind(inputs.source_asset)
  const affiliateMemo = buildMemo(inputs, true)

  if (sourceChainKind === 'utxo') {
    try {
      assertMemoByteLength(affiliateMemo, sourceChainKind)
      return affiliateMemo
    } catch {
      const memoWithoutAffiliate = buildMemo(inputs, false)
      assertMemoByteLength(memoWithoutAffiliate, sourceChainKind)
      return memoWithoutAffiliate
    }
  }

  assertMemoByteLength(affiliateMemo, sourceChainKind)
  return affiliateMemo
}
