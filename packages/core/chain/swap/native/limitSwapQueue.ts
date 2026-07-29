import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { Chain } from '../../Chain'
import { cosmosRpcUrl } from '../../chains/cosmos/cosmosRpcUrl'

const limitSwapQueueApi = `${cosmosRpcUrl[Chain.THORChain]}/thorchain/queue/limit_swaps`

/**
 * A resting limit order as THORNode's advanced-swap-queue reports it.
 *
 * Amounts are THORChain 1e8 fixed point. Assets are in memo notation, but as
 * THORChain itself holds them — i.e. AFTER `fuzzyAssetMatch` expanded whatever
 * abbreviation the placement memo carried (`ETH.USDC-06EB48` comes back as
 * `ETH.USDC-0XA0B8…`). This is the only place the full identifier can be read
 * back, which matters to any future cancel flow: cancel memos skip fuzzy
 * matching and must spell the asset the long way.
 */
export type LimitSwapQueueEntry = {
  /** The original inbound tx hash — the identity orders are matched on. */
  txId: string
  fromAddress?: string
  /** The placement memo, verbatim. */
  memo?: string
  /** The deposited (source) asset, in memo notation, as THORChain resolved it. */
  sourceAsset?: string
  /** The target asset, in full memo notation. */
  targetAsset?: string
  /** `MsgSwap.TradeTarget` verbatim — the memo's LIM, in 1e8 fixed point. */
  tradeTarget?: bigint
  /** What went in, in 1e8 — half of the pair THORChain addresses the order by. */
  deposit?: bigint
  /** How much of the deposit has been swapped so far, in 1e8. */
  amountIn?: bigint
  /** What has been paid out so far, in 1e8. */
  amountOut?: bigint
  /**
   * Execution attempts that missed. NOT failures — the order is still resting;
   * surfacing these as errors would be actively wrong.
   */
  failedSwapReasons: string[]
  /** Blocks until the order expires (~6s per THORChain block). */
  timeToExpiryBlocks?: number
  /**
   * Blocks since placement. Preferred over the wire's `created_timestamp`,
   * which THORNode hardcodes to 0.
   */
  blocksSinceCreated?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseOptionalString = (value: unknown, field: string): string | undefined => {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    throw new Error(`limit swap queue: ${field} is not a string`)
  }
  return value
}

/** Wire numerics arrive as strings; widening is deliberate and validated. */
const parseOptionalAmount = (value: unknown, field: string): bigint | undefined => {
  const text = parseOptionalString(value, field)
  if (text === undefined) return undefined
  if (!/^\d+$/.test(text)) {
    throw new Error(`limit swap queue: ${field} is not an integer amount: ${JSON.stringify(text)}`)
  }
  return BigInt(text)
}

const parseOptionalBlocks = (value: unknown, field: string): number | undefined => {
  const amount = parseOptionalAmount(value, field)
  if (amount === undefined) return undefined
  const blocks = Number(amount)
  if (!Number.isSafeInteger(blocks)) {
    throw new Error(`limit swap queue: ${field} exceeds a safe block count`)
  }
  return blocks
}

/**
 * A `common.Asset` off the wire, reduced to the string a memo spells it with.
 *
 * Decodes BOTH shapes deliberately. THORNode's queriers render assets through
 * `Asset.MarshalJSON` — the flat string `ETH.USDC-0XA0B8…` — but the same
 * message marshalled by protobuf-JSON comes out as an object of chain/symbol/
 * flag fields. Which one a route uses is a property of that route's marshaller,
 * not of the type. Guessing wrong would strand any consumer that needs the
 * exact spelling (a cancel memo keys on it), so both are accepted and anything
 * else throws.
 */
const parseWireAsset = (value: unknown, field: string): string | undefined => {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value
  if (isRecord(value) && typeof value.chain === 'string' && typeof value.symbol === 'string') {
    // Mirrors `common.Asset.String()`: one separator per flavour, the L1 `.`
    // when no flag is set.
    const separator = value.synth === true ? '/' : value.trade === true ? '~' : value.secured === true ? '-' : '.'
    return `${value.chain}${separator}${value.symbol}`
  }
  throw new Error(`limit swap queue: ${field} is neither an asset string nor an asset object`)
}

const parseEntry = (value: unknown): LimitSwapQueueEntry => {
  if (!isRecord(value)) {
    throw new Error('limit swap queue: entry is not an object')
  }
  const swap = value.swap
  if (!isRecord(swap)) {
    throw new Error('limit swap queue: entry has no swap')
  }
  const tx = swap.tx
  if (!isRecord(tx) || typeof tx.id !== 'string' || !tx.id) {
    throw new Error('limit swap queue: entry has no inbound tx id')
  }

  const state = isRecord(swap.state) ? swap.state : undefined
  const coins = Array.isArray(tx.coins) ? tx.coins : []
  const sourceCoin = isRecord(coins[0]) ? coins[0] : undefined

  // Absent is an empty list; present-but-malformed throws like every other
  // field. Silently dropping entries would report "no missed attempts" on the
  // strength of data we didn't understand.
  const rawReasons = state?.failed_swap_reasons ?? []
  if (!Array.isArray(rawReasons) || !rawReasons.every((reason): reason is string => typeof reason === 'string')) {
    throw new Error('limit swap queue: state.failed_swap_reasons is not a string array')
  }
  const failedSwapReasons = rawReasons

  return {
    txId: tx.id,
    fromAddress: parseOptionalString(tx.from_address, 'from_address'),
    memo: parseOptionalString(tx.memo, 'memo'),
    sourceAsset: parseWireAsset(sourceCoin?.asset, 'coins[0].asset'),
    targetAsset: parseWireAsset(swap.target_asset, 'target_asset'),
    tradeTarget: parseOptionalAmount(swap.trade_target, 'trade_target'),
    deposit: parseOptionalAmount(state?.deposit, 'state.deposit'),
    amountIn: parseOptionalAmount(state?.in, 'state.in'),
    amountOut: parseOptionalAmount(state?.out, 'state.out'),
    failedSwapReasons,
    timeToExpiryBlocks: parseOptionalBlocks(value.time_to_expiry_blocks, 'time_to_expiry_blocks'),
    blocksSinceCreated: parseOptionalBlocks(value.blocks_since_created, 'blocks_since_created'),
  }
}

/**
 * Parse `/thorchain/queue/limit_swaps` into typed resting orders.
 *
 * Returns `null` when the `limit_swaps` key is ABSENT — which is not the same
 * as an empty queue, and must never be flattened into one. An order's
 * disappearance from this list is what marks it terminal, so "the queue is
 * empty" is a load-bearing claim: if an unrecognised envelope silently decoded
 * as "no resting orders", every tracked order would be closed at once on the
 * strength of a response we didn't understand. Callers must treat `null` as
 * "no information" and leave orders resting; only an explicit `[]` means the
 * sender has none. Malformed entries throw for the same reason.
 */
export const parseLimitSwapQueue = (body: unknown): LimitSwapQueueEntry[] | null => {
  if (!isRecord(body)) {
    throw new Error('limit swap queue: response is not an object')
  }
  const limitSwaps = body.limit_swaps
  if (limitSwaps === undefined || limitSwaps === null) {
    return null
  }
  if (!Array.isArray(limitSwaps)) {
    throw new Error('limit swap queue: limit_swaps is not an array')
  }
  return limitSwaps.map(parseEntry)
}

const PAGE_LIMIT = 100
// Safety valve against a queue that never reports `has_next: false` — mirrors
// getAllCosmosBalances's pattern. 100 orders/page * 50 pages = 5k orders, far
// past any real sender's resting-order count.
const MAX_PAGES = 50

/** Whether the envelope says there is a further page beyond the one just read. */
const hasNextPage = (body: unknown): boolean =>
  isRecord(body) && isRecord(body.pagination) && body.pagination.has_next === true

/**
 * Fetch the advanced-swap-queue's resting limit orders for a sender.
 *
 * Always scope to a sender: unfiltered, the endpoint returns every resting
 * order on the network.
 *
 * The endpoint is paginated (`pagination: { limit, has_next }`) and a sender
 * with more than one page of resting orders would otherwise only ever see
 * page 1 — an order resting on page 2 would read as "absent from the queue",
 * which callers treat as the order having left and closed. This walks pages
 * while `has_next` is true, deduped by `txId` (the identity orders are
 * matched on) as a defensive no-op if a retried page repeats entries.
 *
 * Failures propagate — a fetch or parse error is "no information", and the
 * caller keeps its orders resting rather than concluding anything from it. An
 * unrecognised envelope on the FIRST page is the same "no information" `null`
 * as a single-page fetch; on a later page it only means we can't confirm
 * anything past what we already collected, so those entries are kept rather
 * than discarded.
 */
export const getLimitSwapQueue = async (sender: string): Promise<LimitSwapQueueEntry[] | null> => {
  const entries: LimitSwapQueueEntry[] = []
  const seenTxIds = new Set<string>()

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      sender,
      'pagination.limit': String(PAGE_LIMIT),
      'pagination.offset': String(page * PAGE_LIMIT),
    })
    const body = await queryUrl<unknown>(`${limitSwapQueueApi}?${params.toString()}`)
    const parsed = parseLimitSwapQueue(body)

    if (parsed === null) {
      if (page === 0) return null
      break
    }

    for (const entry of parsed) {
      if (seenTxIds.has(entry.txId)) continue
      seenTxIds.add(entry.txId)
      entries.push(entry)
    }

    if (!hasNextPage(body)) break
  }

  return entries
}
