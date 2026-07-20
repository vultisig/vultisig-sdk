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
 * journal can't cross-match two different vaults.
 *
 * Cross-path parity: for a NATIVE / simple-EVM send the send-command basis
 * (owner=ecdsa, chain, to=recipient, value=base-unit amount, data=memo) lines up
 * field-for-field with the agent path's basis (executor.ts buildBroadcastIntent),
 * so a direct `send` and an identical `agent ask` dedupe against the ONE shared
 * journal. It does NOT line up for ERC-20 token sends (the agent path fingerprints
 * the on-chain tx — to=token contract, value=0, data=transfer calldata — whereas
 * the send command fingerprints the recipient + token amount) nor for swaps (the
 * swap intent is deliberately a coarse, retry-stable request descriptor). Those
 * cross-path cases are a MISSED dedup, not a double-spend: within each path token
 * sends and swaps still dedupe correctly. Full cross-path parity would require the
 * guard to move down into `vault.send()`/`vault.swap()` — see the residual note on
 * {@link guardedBroadcast}.
 */
import { getChainKind } from '@vultisig/core-chain/ChainKind'
import type { Chain, KeysignPayload, VaultBase } from '@vultisig/sdk'

import {
  assertNoRecentDuplicate,
  type BroadcastIntent,
  computeFingerprint,
  recordBroadcast,
  recordResolution,
  reserveBroadcast,
} from '../agent/broadcastJournal'
import { matchCosmosDeliverTxFailure } from './cosmosDeliverTx'

/**
 * Stable, non-empty journal namespace for the vault. Prefer the ECDSA public key
 * (what the agent path uses, so the two paths cross-dedupe); fall back to the
 * vault id (which is itself the ECDSA pubkey for a real vault) if — defensively —
 * the key is ever absent. FAIL-CLOSED if both are empty: an empty owner would
 * collapse two DIFFERENT vaults sending an identical (chain, to, value) tx into
 * one fingerprint, so rather than broadcast under an ambiguous namespace we refuse
 * (a malformed/uninitialized vault can't reach a signable state anyway).
 */
function ownerOf(vault: VaultBase): string {
  const owner = vault.publicKeys?.ecdsa || vault.id
  if (!owner) {
    throw new Error(
      'Refusing to broadcast: vault has no ECDSA public key or id to namespace the double-spend guard ' +
        '(malformed/uninitialized vault).'
    )
  }
  return owner
}

/**
 * `--max` sends/swaps resolve their amount from live balance/fee state, which
 * drifts between a first broadcast and a retry (fee estimate moves, or the swept
 * balance changes) — so fingerprinting the resolved amount would let a `--max`
 * retry slip past the guard with a slightly different amount and double-spend
 * (the P5-1 hazard, narrowed to `--max`). Instead a `--max` intent fingerprints a
 * stable `max` sentinel: any `--max` send/swap of the same asset to the same
 * destination within the window dedupes regardless of the resolved amount. This
 * intentionally over-blocks a legitimately-different `--max` within the window
 * (the fund-safe direction) — `--force` overrides.
 */
const MAX_AMOUNT_SENTINEL = 'max'

/**
 * Build the dedupe intent for a `send` from its resolved {@link KeysignPayload}.
 * `toAmount` is a base-unit integer string (wei / sats / lamports / …), matching
 * the base-unit `value` the agent path fingerprints, so identical native/EVM sends
 * across the two paths collide. A non-native token folds its contract address in
 * as the asset discriminator; native sends leave `asset` undefined (the token
 * identity is already implied by the chain), mirroring the agent path.
 */
export function buildSendBroadcastIntent(
  vault: VaultBase,
  chain: Chain,
  keysignPayload: KeysignPayload,
  opts: { isMax?: boolean } = {}
): BroadcastIntent {
  const coin = keysignPayload.coin
  const isNative = coin?.isNativeToken ?? !coin?.contractAddress
  return {
    owner: ownerOf(vault),
    chain: chain.toString(),
    to: keysignPayload.toAddress || undefined,
    value: opts.isMax ? MAX_AMOUNT_SENTINEL : keysignPayload.toAmount || undefined,
    // `data` is the user-supplied memo. On an EVM chain the signer encodes a
    // `0x`-prefixed memo AS calldata (memoToTxData), so a memo of `"0x"` is empty
    // calldata — functionally identical to a no-memo native transfer, and it must
    // fold to `""` to cross-path dedupe with the agent path (which fingerprints the
    // same send as empty `"0x"` calldata). On a memo-routed chain (THORChain,
    // Cosmos, UTXO) the memo is a real distinct value and must NOT fold (PR #1259).
    // So the fold is gated on chain kind — the single "is this data EVM calldata?"
    // authority — not hardcoded, which keeps a new chain family from silently
    // reintroducing the memo collision.
    data: keysignPayload.memo || undefined,
    dataIsEvmCalldata: getChainKind(chain) === 'evm',
    asset: isNative ? undefined : coin?.contractAddress || coin?.ticker || undefined,
  }
}

/**
 * Build the dedupe intent for a `swap` from its request. Derived from the stable
 * request fields (from/to chain + token + resolved amount) rather than the live
 * quote, so a retry of the SAME swap intent dedupes even when the best-route
 * quote (provider, exact output) shifts between attempts. `from`/`to` descriptors
 * and the amount fully identify the user's intent. A `--max` swap fingerprints the
 * stable {@link MAX_AMOUNT_SENTINEL} rather than the drift-prone resolved amount.
 */
export function buildSwapBroadcastIntent(
  vault: VaultBase,
  request: { fromChain: Chain; toChain: Chain; fromToken?: string; toToken?: string; amount: string; isMax?: boolean }
): BroadcastIntent {
  return {
    owner: ownerOf(vault),
    chain: request.fromChain.toString(),
    to: request.toChain.toString(),
    value: request.isMax ? MAX_AMOUNT_SENTINEL : request.amount,
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
 *
 * Residual window (known limitation of the CLI-level wire): `broadcast()` is the
 * SDK's compound `vault.send()`/`vault.swap()`, which signs AND broadcasts on-chain
 * internally before returning a hash. If it broadcasts and then throws before
 * returning (a post-broadcast SDK step fails, or — for a multi-leg swap — the
 * ERC-20 approval broadcasts but the main leg then fails), nothing is journaled
 * and a fresh-process retry can re-broadcast. The reservation lock file survives a
 * hard crash for RESERVATION_STALE_MS (5 min) and covers the crash case, but not a
 * caught throw that exits cleanly. Closing this fully requires recording at each
 * SDK broadcast chokepoint (as the agent path does via recordBroadcastForTx) —
 * i.e. pushing the guard down into `vault.send()`/`vault.swap()`, a deliberately
 * deferred larger change. Follow-up: 070726-sdkcli2-01 residual (swap compound leg).
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
  } catch (error) {
    // A Cosmos DeliverTx failure means the signed tx WAS included on-chain and then
    // failed execution — terminal: the sequence is consumed and the gas is spent, so
    // the identical bytes can never re-land. cosmjs embeds the tx hash in the thrown
    // message; journal it as a broadcast + a FAILED resolution so the terminal hash is
    // on the record (tx-status / explorer / audit) rather than discarded, and the guard
    // RE-OPENS: recording `failed` is what clears the intent for a legitimate
    // fresh-sequence rebuild (see broadcastJournal isRetryableResolution). Any other
    // throw broadcast nothing durable we can name here, so it is left to the reservation
    // lock and the error classifier.
    const message = error instanceof Error ? error.message : String(error)
    const deliverTxHash = matchCosmosDeliverTxFailure(message)?.hash
    if (deliverTxHash) {
      recordBroadcast(fingerprint, deliverTxHash, intent.chain)
      recordResolution(deliverTxHash, 'failed')
    }
    throw error
  } finally {
    reservation.release()
  }
}
