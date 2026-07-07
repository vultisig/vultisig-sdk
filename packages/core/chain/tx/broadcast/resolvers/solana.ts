import { SendTransactionError } from '@solana/web3.js'
import { OtherChain } from '@vultisig/core-chain/Chain'
import { getSolanaClient } from '@vultisig/core-chain/chains/solana/client'
import { sendJitoTransaction } from '@vultisig/core-chain/chains/solana/jito'
import { isInError } from '@vultisig/lib-utils/error/isInError'
import base58 from 'bs58'

import { BroadcastTxResolver } from '../resolver'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

const solanaStandardRpcMaxAttempts = 3
const solanaStandardRpcRetryDelayMs = 500

const isTransientBlockhashError = (error: unknown) =>
  isInError(error, 'Blockhash not found', 'blockhash not found', 'BlockhashNotFound')

const wait = (durationMs: number) => new Promise(resolve => setTimeout(resolve, durationMs))

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

const sendSolanaRawTransaction = async (rawTransaction: Uint8Array) => {
  const client = getSolanaClient()

  for (let attempt = 1; attempt <= solanaStandardRpcMaxAttempts; attempt++) {
    try {
      await client.sendRawTransaction(rawTransaction, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      })
      return
    } catch (error) {
      if (isTransientBlockhashError(error) && attempt < solanaStandardRpcMaxAttempts) {
        await wait(solanaStandardRpcRetryDelayMs * attempt)
        continue
      }
      throw error
    }
  }
}

export const broadcastSolanaTx: BroadcastTxResolver<OtherChain.Solana> = async ({ chain, tx }) => {
  const rawTransaction = base58.decode(tx.encoded)

  // Try JITO first for MEV protection, but still relay through standard RPC.
  // JITO can accept sendTransaction without the signature later appearing in
  // public Solana history, so standard RPC propagation is the durable signal.
  try {
    await sendJitoTransaction(rawTransaction)
  } catch (err) {
    console.warn('[solana] JITO sendTransaction failed, falling back to standard RPC:', err)
  }

  try {
    await sendSolanaRawTransaction(rawTransaction)
  } catch (error) {
    // A duplicate-signature error means the node already accepted this exact
    // signed transaction. Treat it as an idempotent success so a headless
    // retry does not blindly re-broadcast the same payload (mirrors the
    // TON/UTXO/Cosmos dedupe guards). verifyBroadcastByHash remains the
    // fallback safety net for genuinely ambiguous (non-duplicate) failures.
    //
    // TRADE-OFF (reviewed + accepted, PR #874): this returns success at the
    // BROADCAST layer WITHOUT verifying the execution outcome. Solana reports
    // `AlreadyProcessed` for any signature it has already seen, including one
    // whose transaction was *processed but reverted on-chain*. So a
    // processed-but-failed Solana tx is reported as success HERE. That is
    // intentional: the broadcast layer's only job is "did the node take this
    // payload", and re-broadcasting an already-accepted signature is useless.
    // The AUTHORITY on actual success/failure is the downstream getTxStatus
    // confirmation poll (#867's confirmBroadcastedTx), which surfaces `failed`
    // for a reverted Solana tx via the status resolver reading
    // `signatureStatus.err` (see ../../status/resolvers/solana.ts). Only a
    // raw-SDK consumer that broadcasts and skips that confirmation poll is
    // exposed to the optimistic result; the CLI agent always confirms.
    if (isInError(error, 'already been processed', 'AlreadyProcessed')) {
      return
    }
    await verifyBroadcastByHash({
      chain,
      tx,
      error: withSolanaBroadcastReason(error),
    })
  }
}
