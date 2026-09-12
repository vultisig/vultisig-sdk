import { SendTransactionError } from '@solana/web3.js'
import { OtherChain } from '@vultisig/core-chain/Chain'
import { getSolanaClient } from '@vultisig/core-chain/chains/solana/client'
import { sendJitoTransaction } from '@vultisig/core-chain/chains/solana/jito'
import { attempt } from '@vultisig/lib-utils/attempt'
import { isInError } from '@vultisig/lib-utils/error/isInError'
import base58 from 'bs58'

import { getSolanaTxHash } from '../../hash/resolvers/solana'
import { broadcastAccepted, broadcastFailed, BroadcastTxResolver, isRetryableBroadcastCause } from '../resolver'
import { SolanaBlockhashExpiredError } from '../solanaBlockhashExpired'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

type SolanaClient = ReturnType<typeof getSolanaClient>

/**
 * Pause between resends of the same signed bytes while no node has confirmed
 * the signature. Leaders drop transactions under load without a rejection, so
 * standard Solana practice is to keep resending until confirmation or expiry;
 * the network deduplicates a resend of a signature it already holds.
 */
export const solanaRebroadcastIntervalMs = 2_000

/**
 * Wall-clock cap on the resend loop, reached only when neither the payload nor
 * the RPC could supply a block-height deadline. A confirmed blockhash lives
 * about 150 blocks (60–90 s), so this outlasts any real deadline.
 */
export const solanaBroadcastMaxDurationMs = 120_000

/**
 * Cap on any single RPC round trip the loop makes. The shared Solana client
 * sets no request timeout, and a half-open socket can leave `fetch` pending
 * for far longer than the whole broadcast budget; the deadline and wall-clock
 * checks only run between awaits, so without this an unanswered request could
 * hold the resolver open indefinitely. Matches the repo's default query timeout.
 */
export const solanaRpcTimeoutMs = 20_000

const isTransientBlockhashError = (error: unknown) => isInError(error, 'Blockhash not found', 'BlockhashNotFound')

// The node's bank is already past the blockhash's last valid height. A node
// cannot run ahead of the cluster, so this is the expiry itself, not lag.
const isBlockHeightExceededError = (error: unknown) => isInError(error, 'block height exceeded', 'BlockHeightExceeded')

const isAlreadyProcessedError = (error: unknown) => isInError(error, 'already been processed', 'AlreadyProcessed')

const wait = (durationMs: number) => new Promise(resolve => setTimeout(resolve, durationMs))

/**
 * Stops waiting on an RPC call after `solanaRpcTimeoutMs`. The underlying
 * request is not aborted (web3.js exposes no signal on these methods); the
 * loop simply treats it as unanswered, which every caller here already handles
 * as "no information". A late settlement is swallowed so it cannot surface as
 * an unhandled rejection.
 */
const withRpcTimeout = <T>(request: Promise<T>, what: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Solana ${what} timed out after ${solanaRpcTimeoutMs}ms`)),
      solanaRpcTimeoutMs
    )
  })
  request.catch(() => {})

  return Promise.race([request, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Hoists the on-chain rejection reason into a Solana send error's message.
 *
 * On a preflight rejection the RPC returns the actionable detail in
 * `data.err` / `data.logs` (the program logs), which `web3.js` exposes via
 * `SendTransactionError.logs`. The bare `.message` ("failed to send
 * transaction") hides it, so any consumer reading only the top-level message
 * loses the reason. Fold the program logs into the message — preserving the
 * original error as `cause` — so the real reason ("insufficient lamports",
 * "custom program error: 0x1", a failed instruction) reaches the surface.
 */
const withSolanaBroadcastReason = (error: unknown): unknown => {
  if (!(error instanceof SendTransactionError)) {
    return error
  }

  const { logs } = error
  if (!logs || logs.length === 0) {
    return error
  }

  return new Error([error.message, ...logs].join('\n'), { cause: error })
}

type SignatureSighting = 'unseen' | 'processed' | 'settled'

/**
 * What the RPC currently knows about a signature. `settled` covers a confirmed
 * or finalized slot and an executed-but-failed transaction alike: the bytes are
 * on-chain either way and resending is pointless. `processed` is a sighting in
 * a slot a fork can still drop, so resends continue. Undefined when the lookup
 * itself failed.
 */
const getSignatureSighting = async (
  client: SolanaClient,
  signature: string,
  searchTransactionHistory = false
): Promise<SignatureSighting | undefined> => {
  const { data } = await attempt(() =>
    withRpcTimeout(client.getSignatureStatuses([signature], { searchTransactionHistory }), 'getSignatureStatuses')
  )
  if (!data) return undefined

  const status = data.value[0]
  if (!status) return 'unseen'
  if (status.err || status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
    return 'settled'
  }

  return 'processed'
}

const isBlockHeight = (value: number | undefined): value is number =>
  value !== undefined && Number.isSafeInteger(value) && value >= 0

/**
 * The block height past which these bytes can no longer land. The payload's
 * own `lastValidBlockHeight` is exact. Without it (a co-signer or dApp that
 * predates the field) the newest blockhash's deadline stands in: it is at or
 * past the real one, so the loop can over-wait but never declare expiry early.
 */
const resolveDeadline = async (client: SolanaClient, lastValidBlockHeight: number | undefined) => {
  if (isBlockHeight(lastValidBlockHeight)) return lastValidBlockHeight

  const { data } = await attempt(() => withRpcTimeout(client.getLatestBlockhash('confirmed'), 'getLatestBlockhash'))

  return data?.lastValidBlockHeight
}

const isPastDeadline = async (client: SolanaClient, deadline: number | undefined) => {
  if (deadline === undefined) return false

  const { data: blockHeight } = await attempt(() =>
    withRpcTimeout(client.getBlockHeight('confirmed'), 'getBlockHeight')
  )

  return typeof blockHeight === 'number' && blockHeight > deadline
}

type ConcludeUnconfirmedInput = {
  client: SolanaClient
  signature: string | undefined
  deadline: number | undefined
  expired: boolean
  sent: boolean
  lastSendError: unknown
}

/**
 * The loop's end without a confirmation. One last look through transaction
 * history first: the bytes may have landed in the final valid block, or a
 * co-signer's broadcast may have.
 *
 * Declaring expiry needs POSITIVE evidence of absence — a history lookup that
 * succeeded and found nothing. A lookup that merely failed proves nothing: a
 * transfer can land in its last valid block while the status RPC is
 * unreachable, and `recovery: 'resign'` on top of that would invite the user
 * to pay twice. On an unusable lookup, bytes the RPC accepted are left to the
 * downstream status poll, which carries the same deadline and can settle it
 * later from fresh information.
 */
const concludeUnconfirmed = async ({
  client,
  signature,
  deadline,
  expired,
  sent,
  lastSendError,
}: ConcludeUnconfirmedInput) => {
  // Undefined either way means "no proof of absence": the lookup failed, or
  // there is no signature to look up.
  const sighting = signature ? await getSignatureSighting(client, signature, true) : undefined

  if (sighting === 'settled' || sighting === 'processed') return broadcastAccepted(signature)

  if (expired && sighting === 'unseen') {
    return broadcastFailed(new SolanaBlockhashExpiredError({ signature, lastValidBlockHeight: deadline }), false)
  }

  if (sent) return broadcastAccepted(signature)

  return broadcastFailed(lastSendError, isRetryableBroadcastCause(lastSendError))
}

export const broadcastSolanaTx: BroadcastTxResolver<OtherChain.Solana> = async ({
  chain,
  tx,
  lastValidBlockHeight,
}) => {
  let rawTransaction: Uint8Array
  try {
    rawTransaction = base58.decode(tx.encoded)
  } catch (cause) {
    return broadcastFailed(cause, false)
  }

  // Try JITO first for MEV protection, but still relay through standard RPC.
  // JITO can accept sendTransaction without the signature later appearing in
  // public Solana history, so standard RPC propagation is the durable signal.
  try {
    await sendJitoTransaction(rawTransaction)
  } catch (err) {
    console.warn('[solana] JITO sendTransaction failed, falling back to standard RPC:', err)
  }

  const client = getSolanaClient()
  const deadline = await resolveDeadline(client, lastValidBlockHeight)
  const startedAt = Date.now()
  // Known before the first send, so a co-signer's broadcast (or a send whose
  // response was lost) is still found by polling.
  let { data: signature } = await attempt(async () => getSolanaTxHash(tx))
  let sent = false
  let lastSendError: unknown

  while (true) {
    const { data: acceptedSignature, error: sendError } = await attempt(() =>
      withRpcTimeout(
        client.sendRawTransaction(rawTransaction, {
          // Preflight until the RPC has accepted the bytes once: it is how a
          // real rejection (insufficient lamports, a failing program) surfaces.
          // A resend skips it, so a node whose simulation bank lags cannot veto
          // bytes a leader already holds.
          skipPreflight: sent,
          preflightCommitment: 'confirmed',
          // The node's own resend loop would race this one.
          maxRetries: 0,
        }),
        'sendTransaction'
      )
    )

    if (acceptedSignature !== undefined) {
      sent = true
      signature ??= acceptedSignature
    } else {
      // A duplicate-signature error means the node already accepted this exact
      // signed transaction. Treat it as an idempotent success so a headless
      // retry does not blindly re-broadcast the same payload (mirrors the
      // TON/UTXO/Cosmos dedupe guards).
      //
      // TRADE-OFF (reviewed + accepted, PR #874): this returns success at the
      // BROADCAST layer WITHOUT verifying the execution outcome. Solana reports
      // `AlreadyProcessed` for any signature it has already seen, including one
      // whose transaction was *processed but reverted on-chain*. That is
      // intentional: the broadcast layer's only job is "did the node take this
      // payload". The AUTHORITY on actual success/failure is the downstream
      // getTxStatus confirmation poll, which surfaces `failed` for a reverted
      // Solana tx via `signatureStatus.err` (see ../../status/resolvers/solana.ts).
      if (isAlreadyProcessedError(sendError)) {
        return broadcastAccepted(signature)
      }

      if (isBlockHeightExceededError(sendError)) {
        return concludeUnconfirmed({ client, signature, deadline, expired: true, sent, lastSendError: sendError })
      }

      const isRecoverable = isTransientBlockhashError(sendError) || isRetryableBroadcastCause(sendError)
      if (!sent && !isRecoverable) {
        // A preflight verdict on the bytes themselves. A co-signer may still
        // have landed the same signature, so the hash lookup gets the last
        // word before this is reported as a rejection.
        const cause = withSolanaBroadcastReason(sendError)
        try {
          return broadcastAccepted(
            await verifyBroadcastByHash({ chain, tx, error: cause, lastValidBlockHeight: deadline })
          )
        } catch (verifiedCause) {
          return broadcastFailed(verifiedCause, false)
        }
      }

      // Propagation lag ("Blockhash not found" from a node that has not seen
      // the confirmed blockhash yet) or a transport hiccup: the deadline, not
      // an attempt counter, decides when to stop trying.
      lastSendError = sendError
    }

    if (signature) {
      const sighting = await getSignatureSighting(client, signature)
      if (sighting === 'settled') return broadcastAccepted(signature)
    }

    const expired = await isPastDeadline(client, deadline)
    if (expired || Date.now() - startedAt >= solanaBroadcastMaxDurationMs) {
      return concludeUnconfirmed({ client, signature, deadline, expired, sent, lastSendError })
    }

    await wait(solanaRebroadcastIntervalMs)
  }
}
