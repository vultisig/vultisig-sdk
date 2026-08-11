/**
 * RN-safe Solana JSON-RPC helpers.
 *
 * These accept an explicit `rpcUrl` so consumers keep control over endpoint
 * selection (vultisig's `rootApiUrl` vs app-specific gateway vs Jito's private
 * mempool for broadcasts). Every call goes through the SDK's own `jsonRpcCall`
 * over `fetch` — we never instantiate `@solana/web3.js`'s `Connection`, which
 * would pull `rpc-websockets` into the bundle at import time.
 */

import { attempt } from '@vultisig/lib-utils/attempt'

import { deriveSolanaRawTxSignature } from '../../../../chains/solana/rawTx'
import { jsonRpcCall, JsonRpcCallOptions, JsonRpcError } from '../../rpcFetch'

type RpcRequestOptions = Pick<JsonRpcCallOptions, 'signal' | 'timeoutMs'>

type RpcBlockhash = {
  context: { slot: number }
  value: { blockhash: string; lastValidBlockHeight: number }
}

type RpcBalance = {
  context: { slot: number }
  value: number
}

export type BroadcastSolanaTxOptions = {
  skipPreflight?: boolean
  preflightCommitment?: 'processed' | 'confirmed' | 'finalized'
  maxRetries?: number
  signal?: AbortSignal
  timeoutMs?: number
}

type RpcSignatureStatus = {
  err: unknown | null
}

type RpcSignatureStatuses = {
  context: { slot: number }
  value: Array<RpcSignatureStatus | null>
}

const broadcastVerificationMaxAttempts = 4
const broadcastVerificationBaseDelayMs = 500

const wait = (durationMs: number, signal?: AbortSignal) =>
  new Promise<void>(resolve => {
    if (signal?.aborted) {
      resolve()
      return
    }

    const onDone = () => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onDone)
      resolve()
    }
    const timeout = setTimeout(onDone, durationMs)
    signal?.addEventListener('abort', onDone, { once: true })
  })

const getSignatureStatus = (value: unknown): RpcSignatureStatus | null | undefined => {
  if (!value || typeof value !== 'object' || !('value' in value)) return undefined

  const statuses = (value as { value?: unknown }).value
  if (!Array.isArray(statuses)) return undefined

  const status = statuses[0]
  if (status === null) return null
  if (!status || typeof status !== 'object' || !('err' in status)) return undefined

  return status as RpcSignatureStatus
}

const isAlreadyProcessedError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? '')
  const data = error instanceof JsonRpcError ? JSON.stringify(error.data ?? '') : ''
  const detail = `${message} ${data}`.toLowerCase()

  return detail.includes('already been processed') || detail.includes('alreadyprocessed')
}

/**
 * Fetch the latest blockhash + last-valid-block-height from a Solana RPC.
 * Matches `Connection.getLatestBlockhash()` output for drop-in use by tx
 * builders that need a `recentBlockhash` before signing.
 */
export async function getSolanaRecentBlockhash(
  rpcUrl: string,
  options: RpcRequestOptions = {}
): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  const res = await jsonRpcCall<RpcBlockhash>(rpcUrl, 'getLatestBlockhash', [{ commitment: 'confirmed' }], options)
  return {
    blockhash: res.value.blockhash,
    lastValidBlockHeight: res.value.lastValidBlockHeight,
  }
}

/**
 * Fetch native SOL balance in lamports. Returns `0n` if the account does not
 * yet exist (consistent with `Connection.getBalance` on an uninitialized
 * account).
 */
export async function getSolanaBalance(
  address: string,
  rpcUrl: string,
  options: RpcRequestOptions = {}
): Promise<bigint> {
  const res = await jsonRpcCall<RpcBalance>(rpcUrl, 'getBalance', [address, { commitment: 'confirmed' }], options)
  return BigInt(res.value ?? 0)
}

/**
 * Broadcast a signed Solana transaction (base64-serialized). Returns its
 * deterministic primary signature (base58), never an unverified hash supplied
 * by the RPC.
 *
 * `AlreadyProcessed` is idempotent broadcast success. Every other send error
 * is ambiguous, so this helper checks `getSignatureStatuses` with bounded
 * backoff and only resolves when the same signature is already known without
 * an execution error. If the status remains missing, failed, or unavailable,
 * the original send error is rethrown. This matches the core broadcast
 * resolver's acceptance guarantee.
 *
 * A returned signature proves broadcast acceptance, not final confirmation.
 * Consumers must continue polling transaction status until success or failure.
 * The caller should prefer `sendTransaction` over `sendRawTransaction` — the
 * JSON-RPC method name is the same, but we pass `encoding: 'base64'`
 * explicitly so the node doesn't guess.
 *
 * For Jito bundle broadcasting, use a Jito-provided `rpcUrl` (same method).
 */
export async function broadcastSolanaTx(
  rawTxBase64: string,
  rpcUrl: string,
  opts: BroadcastSolanaTxOptions = {}
): Promise<string> {
  const signature = deriveSolanaRawTxSignature(rawTxBase64, 'base64')
  const sendResult = await attempt(
    jsonRpcCall<string>(
      rpcUrl,
      'sendTransaction',
      [
        rawTxBase64,
        {
          encoding: 'base64',
          skipPreflight: opts.skipPreflight ?? false,
          preflightCommitment: opts.preflightCommitment ?? 'confirmed',
          maxRetries: opts.maxRetries ?? 3,
        },
      ],
      { signal: opts.signal, timeoutMs: opts.timeoutMs }
    )
  )

  if ('data' in sendResult) {
    if (sendResult.data !== signature) {
      throw new Error('Solana RPC returned a signature that does not match the signed transaction')
    }
    return signature
  }

  if (isAlreadyProcessedError(sendResult.error)) {
    return signature
  }

  for (let verificationAttempt = 1; verificationAttempt <= broadcastVerificationMaxAttempts; verificationAttempt++) {
    if (opts.signal?.aborted) break

    const statusResult = await attempt(
      jsonRpcCall<RpcSignatureStatuses>(
        rpcUrl,
        'getSignatureStatuses',
        [[signature], { searchTransactionHistory: true }],
        { signal: opts.signal, timeoutMs: opts.timeoutMs }
      )
    )

    if ('data' in statusResult) {
      const status = getSignatureStatus(statusResult.data)
      if (status?.err === null) {
        return signature
      }
      if (status && status.err !== null) {
        break
      }
    }

    if (verificationAttempt < broadcastVerificationMaxAttempts) {
      await wait(broadcastVerificationBaseDelayMs * verificationAttempt, opts.signal)
    }
  }

  throw sendResult.error
}
