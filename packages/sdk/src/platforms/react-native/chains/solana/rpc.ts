/**
 * RN-safe Solana JSON-RPC helpers.
 *
 * These accept an explicit `rpcUrl` so consumers keep control over endpoint
 * selection (vultisig's `rootApiUrl` vs app-specific gateway vs Jito's private
 * mempool for broadcasts). Every call goes through the SDK's own `jsonRpcCall`
 * over `fetch` — we never instantiate `@solana/web3.js`'s `Connection`, which
 * would pull `rpc-websockets` into the bundle at import time.
 */

import { jsonRpcCall } from '../../rpcFetch'

type RpcBlockhash = {
  context: { slot: number }
  value: { blockhash: string; lastValidBlockHeight: number }
}

type RpcBalance = {
  context: { slot: number }
  value: number
}

type RpcSendTxOpts = {
  encoding?: 'base64' | 'base58'
  skipPreflight?: boolean
  preflightCommitment?: 'processed' | 'confirmed' | 'finalized'
  maxRetries?: number
}

/**
 * Fetch the latest blockhash + last-valid-block-height from a Solana RPC.
 * Matches `Connection.getLatestBlockhash()` output for drop-in use by tx
 * builders that need a `recentBlockhash` before signing.
 */
export async function getSolanaRecentBlockhash(
  rpcUrl: string
): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  const res = await jsonRpcCall<RpcBlockhash>(rpcUrl, 'getLatestBlockhash', [{ commitment: 'confirmed' }])
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
export async function getSolanaBalance(address: string, rpcUrl: string): Promise<bigint> {
  const res = await jsonRpcCall<RpcBalance>(rpcUrl, 'getBalance', [address, { commitment: 'confirmed' }])
  return BigInt(res.value ?? 0)
}

/**
 * Broadcast a signed Solana transaction (base64-serialized). Returns the
 * on-chain signature (base58). The caller should prefer `sendTransaction`
 * over `sendRawTransaction` — the JSON-RPC method name is the same, but we
 * pass `encoding: 'base64'` explicitly so the node doesn't guess.
 *
 * For Jito bundle broadcasting, use a Jito-provided `rpcUrl` (same method).
 */
export async function broadcastSolanaTx(
  rawTxBase64: string,
  rpcUrl: string,
  opts: Omit<RpcSendTxOpts, 'encoding'> = {}
): Promise<string> {
  return jsonRpcCall<string>(rpcUrl, 'sendTransaction', [
    rawTxBase64,
    {
      encoding: 'base64',
      skipPreflight: opts.skipPreflight ?? false,
      preflightCommitment: opts.preflightCommitment ?? 'confirmed',
      maxRetries: opts.maxRetries ?? 3,
    },
  ])
}
