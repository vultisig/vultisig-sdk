/**
 * Broadcast dedupe guard for the direct `send` / `swap` CLI commands.
 *
 * The `agent ask` path already guards every broadcast against the persistent
 * journal (`clients/cli/src/agent/broadcastJournal.ts`) so a retry can't
 * re-broadcast an identical intent (audit F1/F14 — the #952/#927 work). The
 * direct `send` / `swap` verbs called `vault.send()` / `vault.swap()` straight
 * through and NEVER touched that journal, so a retried `send` double-spent
 * (audit P5-1, HIGH). This module wires the SAME exported helpers
 * (`assertNoRecentDuplicate` / `reserveBroadcast` / `recordBroadcast`) into
 * those commands so both paths share ONE journal file and dedupe against each
 * other.
 *
 * The intent basis here is the resolved {@link KeysignPayload} (send) or the
 * swap request (swap), namespaced by the vault's ECDSA public key so a shared
 * journal can't cross-match two different vaults. For a native/EVM send this
 * lines up with the agent path's own basis (owner, chain, to, base-unit amount,
 * memo), so a `send` and an identical `agent ask` cross-dedupe.
 */
import type { Chain, KeysignPayload, VaultBase } from '@vultisig/sdk'

import {
  assertNoRecentDuplicate,
  type BroadcastIntent,
  computeFingerprint,
  recordBroadcast,
  reserveBroadcast,
} from '../agent/broadcastJournal'

/** The owning vault's ECDSA public key, used to namespace the journal. */
function ownerOf(vault: VaultBase): string | undefined {
  return vault.publicKeys?.ecdsa || undefined
}

/**
 * Build the dedupe intent for a `send` from its resolved {@link KeysignPayload}.
 * `toAmount` is a base-unit integer string (wei / sats / lamports / …), matching
 * the base-unit `value` the agent path fingerprints, so identical sends across
 * the two paths collide. A non-native token folds its contract address in as the
 * asset discriminator; native sends leave `asset` undefined (the token identity
 * is already implied by the chain), mirroring the agent path.
 */
export function buildSendBroadcastIntent(
  vault: VaultBase,
  chain: Chain,
  keysignPayload: KeysignPayload
): BroadcastIntent {
  const coin = keysignPayload.coin
  const isNative = coin?.isNativeToken ?? !coin?.contractAddress
  return {
    owner: ownerOf(vault),
    chain: chain.toString(),
    to: keysignPayload.toAddress || undefined,
    value: keysignPayload.toAmount || undefined,
    data: keysignPayload.memo || undefined,
    asset: isNative ? undefined : coin?.contractAddress || coin?.ticker || undefined,
  }
}

/**
 * Build the dedupe intent for a `swap` from its request. Derived from the stable
 * request fields (from/to chain + token + human amount) rather than the live
 * quote, so a retry of the SAME swap intent dedupes even when the best-route
 * quote (provider, exact output) shifts between attempts. `from`/`to`
 * descriptors and the amount fully identify the user's intent.
 */
export function buildSwapBroadcastIntent(
  vault: VaultBase,
  request: { fromChain: Chain; toChain: Chain; fromToken?: string; toToken?: string; amount: string }
): BroadcastIntent {
  return {
    owner: ownerOf(vault),
    chain: request.fromChain.toString(),
    to: request.toChain.toString(),
    value: request.amount,
    data: `swap:${request.fromToken || 'native'}->${request.toToken || 'native'}`,
    asset: request.fromToken || undefined,
  }
}

/**
 * Run a broadcast under the dedupe guard shared with the agent path.
 *
 * Refuses (throwing {@link DuplicateBroadcastError} / {@link ConcurrentBroadcastError},
 * both → exit code 9) if `intent` was broadcast recently and hasn't definitively
 * failed, or if a sibling process holds the reservation — UNLESS `force` is set.
 * Otherwise reserves the intent, runs `broadcast()`, records the resulting hash
 * to the journal so a later retry recognises it, and releases the reservation.
 */
export async function guardedBroadcast<T extends { txHash: string }>(
  intent: BroadcastIntent,
  force: boolean,
  broadcast: () => Promise<T>
): Promise<T> {
  // Pre-sign duplicate check against COMMITTED journal records.
  assertNoRecentDuplicate(intent, { force })

  // Atomic reservation closes the check-then-record TOCTOU: two sibling
  // processes can both pass the check above (neither has recorded a hash yet),
  // so an exclusive per-intent lock lets exactly one proceed; the loser throws
  // ConcurrentBroadcastError. Held across the broadcast, released once the
  // durable journal record takes over as the guard.
  const fingerprint = computeFingerprint(intent)
  const reservation = reserveBroadcast(fingerprint, { force })
  try {
    const result = await broadcast()
    // Journal the broadcast the instant the hash returns so a later retry (in a
    // fresh process) recognises this intent and refuses to double-send.
    recordBroadcast(fingerprint, result.txHash, intent.chain)
    return result
  } finally {
    reservation.release()
  }
}
