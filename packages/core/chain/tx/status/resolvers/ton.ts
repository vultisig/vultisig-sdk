import { Chain, OtherChain } from '@vultisig/core-chain/Chain'
import { getTonRelayedRequestFailure, getTonTxFailure } from '@vultisig/core-chain/chains/ton/failure'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { rootApiUrl } from '@vultisig/core-config'
import { attempt } from '@vultisig/lib-utils/attempt'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { TxStatusResolver } from '../resolver'

type TonComputePhase = {
  exit_code?: number
}

type TonActionPhase = {
  success?: boolean
  no_funds?: boolean
  result_code?: number
  tot_actions?: number
  skipped_actions?: number
  msgs_created?: number
}

type TonTransactionDescription = {
  aborted?: boolean
  compute_ph?: TonComputePhase
  action?: TonActionPhase
}

type TonInboundMessage = {
  /** The sending account for an internal message; empty for an external one. */
  source?: string | null
  /** The body's leading 32 bits as `0x…`, when the message has one. */
  opcode?: string | null
}

type TonOutboundMessage = {
  hash: string
  opcode?: string | null
}

type TonTransaction = {
  hash: string
  total_fees: string
  in_msg?: TonInboundMessage | null
  out_msgs?: TonOutboundMessage[]
  description?: TonTransactionDescription
}

type TonTransactionsResponse = {
  transactions: Array<TonTransaction>
}

type TonTrace = {
  transactions: Record<string, TonTransaction>
}

type TonTracesResponse = {
  traces: Array<TonTrace>
}

/** Which message field the transaction is looked up by. */
type TonMessageLookup = 'msg_hash' | 'body_hash'

const findTonTransaction = async (lookup: TonMessageLookup, hash: string): Promise<TonTransaction | undefined> => {
  const params = new URLSearchParams({ [lookup]: hash, direction: 'in', limit: '1' })
  const url = `${rootApiUrl}/ton/v3/transactionsByMessage?${params}`

  const { data: response } = await attempt(() => queryUrl<TonTransactionsResponse>(url))

  return response?.transactions?.[0]
}

/** The W5 `internal_signed` opcode as toncenter spells a message's opcode. */
const tonRelayedRequestOpcode = '0x73696e74'

const isTonRelayedRequest = (message: TonInboundMessage | TonOutboundMessage | null | undefined): boolean =>
  message?.opcode === tonRelayedRequestOpcode

/** Which trace field the trace is looked up by: its id, or the hash of any message in it. */
type TonTraceLookup = 'trace_id' | 'msg_hash'

const findTonTrace = async (lookup: TonTraceLookup, hash: string): Promise<TonTrace | undefined> => {
  const params = new URLSearchParams({ [lookup]: hash })
  const url = `${rootApiUrl}/ton/v3/traces?${params}`

  const { data: response } = await attempt(() => queryUrl<TonTracesResponse>(url))

  return response?.traces?.[0]
}

type TonResolvedTransaction = {
  /** Whether the indexer has the send at all — the transaction itself, or the relay's part of it. */
  isKnown: boolean
  /** The transaction to judge: the wallet's own, once it has landed. */
  tx?: TonTransaction
}

/**
 * The wallet's transaction behind a transaction the message hash matched.
 *
 * A direct send's external message lands on the wallet, so the match is the
 * wallet's transaction. A relayed send's identifier is the relay's own
 * external message, so the match is the relay's transaction — the one that
 * emitted the signed request to the wallet as an internal message. Judging
 * that would report the relay's success and its fee whatever the wallet then
 * did, so the request is followed to the wallet's transaction, which is
 * pending until it lands.
 */
const followTonRelayDelivery = async (tx: TonTransaction): Promise<TonResolvedTransaction> => {
  const delivered = tx.in_msg?.source ? undefined : tx.out_msgs?.find(isTonRelayedRequest)
  if (!delivered) {
    return { isKnown: true, tx }
  }

  return { isKnown: true, tx: await findTonTransaction('msg_hash', delivered.hash) }
}

/**
 * The wallet's transaction inside a relayed send's trace, for an identifier
 * that matches no message directly: the id of the trace, or the hash of a
 * message in it. The wallet's transaction is the one that received the signed
 * request as an internal message.
 */
const findTonRelayedWalletTransaction = async (hash: string): Promise<TonResolvedTransaction> => {
  const trace = (await findTonTrace('trace_id', hash)) ?? (await findTonTrace('msg_hash', hash))
  if (!trace) {
    return { isKnown: false }
  }

  return {
    isKnown: true,
    tx: Object.values(trace.transactions).find(tx => isTonRelayedRequest(tx.in_msg)),
  }
}

/**
 * Resolves a TON transaction by the hash of the message that carried it.
 *
 * A direct send is identified by the hash of its external message, which the
 * broadcast returned. A relayed (gasless) send is identified by the external
 * message the relay broadcast — explorers resolve it — and the transaction to
 * judge is the wallet's, reached through the signed request the relay's
 * transaction emitted, or through the trace when the identifier is the trace
 * id rather than a message hash. A relayed send whose relay reported no
 * identifier falls back to the hash of the signed request body, fixed at
 * signing time. The indexer is asked for the message hash first and for the
 * others only when nothing matched.
 *
 * Success requires the transaction to be un-aborted *and* to have cleared both
 * the compute and the action phase; a transaction the indexer knows but hasn't
 * fully described yet stays pending. The action phase matters because it is
 * where the wallet actually emits the transfer: a transaction can pass compute
 * and land un-aborted while moving nothing, with the seqno consumed either way.
 * A failure comes back explained (`failure`) so the UI can say what went wrong
 * and how to fix it.
 */
export const getTonTxStatus: TxStatusResolver<OtherChain.Ton> = async ({ hash }) => {
  const matched = (await findTonTransaction('msg_hash', hash)) ?? (await findTonTransaction('body_hash', hash))
  const resolved = matched ? await followTonRelayDelivery(matched) : await findTonRelayedWalletTransaction(hash)
  const { tx } = resolved

  if (!tx) {
    // The relay's part is indexed but the wallet's transaction is not yet: the
    // request is still on its way through the relay.
    return { status: 'pending', isKnown: resolved.isKnown }
  }

  const { description } = tx

  if (!description) {
    // Indexed, but the execution details haven't landed yet. Keep polling rather
    // than reading the missing phases as success.
    return { status: 'pending', isKnown: true }
  }

  const isRelayed = !!tx.in_msg?.source

  // The fee of a relayed send is the relay's commission, charged in the jetton
  // and known from the payload; the TON this transaction burned came out of
  // what the relay attached, so reporting it as the fee would misstate what
  // the user paid.
  const feeCoin = chainFeeCoin[Chain.Ton]
  const feeStr = tx.total_fees
  const receipt =
    !isRelayed && feeStr != null && feeStr !== ''
      ? {
          feeAmount: BigInt(feeStr),
          feeDecimals: feeCoin.decimals,
          feeTicker: feeCoin.ticker,
        }
      : undefined

  const failure =
    getTonTxFailure(description) ??
    getTonRelayedRequestFailure({
      isRelayed,
      totalActions: description.action?.tot_actions,
    })

  return failure ? { status: 'error', receipt, failure } : { status: 'success', receipt }
}
