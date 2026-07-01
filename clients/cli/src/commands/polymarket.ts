/**
 * ⚠️ SPIKE / THROWAWAY — NOT FOR MERGE ⚠️
 *
 * Deterministic Polymarket protocol command (Path B) — prototype of
 *   vultisig polymarket buy --token-id X --price 0.80 --size 10 [--tif ioc|gtc]
 *
 * Proves the wiring for a build→sign→submit flow with the LLM REMOVED:
 *   1. BUILD   — call mcp-ts `polymarket_place_bet` directly over MCP/HTTP.
 *                It returns `sign_action.params.payloads` (the Order + ClobAuth
 *                EIP-712 payloads) and an `order_ref`; the order struct is held
 *                server-side in the mcp-ts process, keyed by order_ref.
 *   2. SIGN    — MPC-sign both payloads LOCALLY via the CLI's existing
 *                AgentExecutor.signTypedData (vault.signBytes → VultiServer co-sign).
 *   3. SUBMIT  — call mcp-ts `polymarket_submit_order` with order_ref + the two
 *                signatures. Handles the `needs_fresh_auth` re-sign loop (the L1
 *                ClobAuth timestamp has a ~180s window).
 *
 * See the spike report:
 *   .claude/knowledge/tasks/010726-spike-protocol-commands-report.md
 *
 * STUBS / ASSUMPTIONS (noted in the report):
 *  - `--token-id` is passed to place_bet as `token_id`, which ASSUMES §A
 *    (mcp-ts PR #727, branch fix/pm-placebet-token-id) has landed. On current
 *    mcp-ts `origin/main`, place_bet resolves via (event_slug, outcome) instead,
 *    so `--event-slug`/`--outcome` are accepted as a fallback to exercise the
 *    wiring against a stock mcp-ts.
 *  - `--tif ioc|gtc` is accepted and forwarded as `order_type`, but stock
 *    place_bet ignores it (always builds a marketable, cross-the-spread order).
 *    Real IOC/FOK is a §A dependency.
 */
import type { VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'

import { AgentExecutor } from '../agent/executor'
import { PmSpikeMcpClient } from '../agent/pmSpikeMcp'
import type { CommandContext } from '../core'
import { ensureVaultUnlocked } from '../core'
import { info, isJsonOutput, outputJson } from '../lib/output'

export type PolymarketBuyParams = {
  tokenId?: string
  price?: number
  size: number
  tif?: 'ioc' | 'gtc'
  // §A-missing fallback so the prototype runs against stock mcp-ts main:
  eventSlug?: string
  outcome?: string
  password?: string
  verbose?: boolean
}

type SignatureEntry = {
  id: string
  signature: string
  [k: string]: unknown
}

/** Resolve the mcp-ts base URL for the spike. Defaults to the local dev port. */
function resolveMcpUrl(): string {
  return process.env.PM_SPIKE_MCP_URL || process.env.MCP_SERVER_URL || 'http://127.0.0.1:9091'
}

/**
 * Deterministic Polymarket BUY — build → MPC-sign → submit, no LLM.
 */
export async function executePolymarketBuy(ctx: CommandContext, params: PolymarketBuyParams): Promise<unknown> {
  const vault = await ctx.ensureActiveVault()
  await ensureVaultUnlocked(vault, params.password)

  const makerAddress = await vault.address(Chain.Polygon)
  const mcp = new PmSpikeMcpClient(resolveMcpUrl(), {
    authToken: process.env.MCP_INBOUND_TOKEN,
    verbose: params.verbose,
  })

  // ── 1. BUILD ───────────────────────────────────────────────────────────────
  // Assemble place_bet args deterministically from the caller's exact params.
  const buildArgs: Record<string, unknown> = {
    side: 'buy',
    maker_address: makerAddress,
    amount: params.size, // shares
  }
  if (params.tokenId) buildArgs.token_id = params.tokenId // §A path
  if (params.eventSlug) buildArgs.event_slug = params.eventSlug // fallback
  if (params.outcome) buildArgs.outcome = params.outcome // fallback
  if (params.price !== undefined) buildArgs.price = params.price
  if (params.tif) buildArgs.order_type = params.tif // §A-dependent; ignored by stock main

  if (!params.tokenId && !(params.eventSlug && params.outcome)) {
    throw new Error(
      'polymarket buy: provide --token-id (requires §A) or, against stock mcp-ts, --event-slug and --outcome.'
    )
  }

  info('→ building order via mcp-ts polymarket_place_bet …')
  const built = await mcp.callTool('polymarket_place_bet', buildArgs)

  if (built.action === 'fund' || built.status === 'needs_funding') {
    throw new Error(
      `Deposit wallet underfunded: ${String(built.message ?? 'needs funding')} ` +
        `(deposit_wallet=${String(built.deposit_wallet ?? '?')})`
    )
  }
  const orderRef = built.order_ref as string | undefined
  const signAction = built.sign_action as { params?: { payloads?: unknown[] } } | undefined
  const payloads = signAction?.params?.payloads
  if (!orderRef || !Array.isArray(payloads) || payloads.length === 0) {
    throw new Error(`place_bet did not return an order_ref + sign payloads. Got: ${JSON.stringify(built).slice(0, 600)}`)
  }
  info(`  order_ref=${orderRef}  ${String(built.summary ?? '')}`)

  // ── 2. SIGN (local MPC) ──────────────────────────────────────────────────────
  info('→ MPC-signing Order + ClobAuth locally …')
  const signatures = await signPayloads(vault, ctx, params, payloads)
  const orderSig = signatures.find(s => s.id === 'order')?.signature
  let authSig = signatures.find(s => s.id === 'auth')?.signature
  if (!orderSig || !authSig) {
    throw new Error(`signing did not yield both order + auth signatures. Got ids: ${signatures.map(s => s.id).join(',')}`)
  }

  // ── 3. SUBMIT (with fresh-auth re-sign loop) ─────────────────────────────────
  // Allow ONE re-sign of a stale ClobAuth, then require a terminal result. A
  // freshly re-signed auth that STILL comes back needs_fresh_auth must fail
  // loudly rather than fall through to a false "ok" — the order was never
  // accepted by the CLOB. (Codex signing sanity pass, 2026-07-02.)
  info('→ submitting to CLOB via mcp-ts polymarket_submit_order …')
  const MAX_SUBMIT_ATTEMPTS = 2
  let submitResult: Record<string, unknown> | null = null
  for (let attempt = 0; attempt < MAX_SUBMIT_ATTEMPTS; attempt++) {
    const res = await mcp.callTool('polymarket_submit_order', {
      order_ref: orderRef,
      order_signature: orderSig,
      auth_signature: authSig,
      address: makerAddress,
    })
    if (res.status === 'needs_fresh_auth' && res.auth_payload) {
      if (attempt === MAX_SUBMIT_ATTEMPTS - 1) {
        // No attempts left — a re-signed auth still stale means we never got a
        // terminal submit. Do NOT report success.
        throw new Error('polymarket submit: auth still stale after re-sign — order was not submitted')
      }
      // The L1 ClobAuth timestamp went stale; re-sign the fresh payload and retry.
      info('  auth stale — re-signing fresh ClobAuth …')
      const fresh = await signPayloads(vault, ctx, params, [res.auth_payload])
      const freshAuth = fresh.find(s => s.id === 'auth' || s.id === 'default')?.signature
      if (!freshAuth) throw new Error('could not re-sign fresh ClobAuth payload')
      authSig = freshAuth
      continue
    }
    submitResult = res
    break
  }
  if (!submitResult) {
    throw new Error('polymarket submit: no terminal result from polymarket_submit_order')
  }

  const out = {
    ok: submitResult.status !== 'error',
    order_ref: orderRef,
    maker_address: makerAddress,
    build_summary: built.summary,
    submit: submitResult,
  }
  if (isJsonOutput()) outputJson(out)
  else info(`✓ done: ${JSON.stringify(submitResult)}`)
  return out
}

/** MPC-sign a payloads array through the CLI's real signing path (AgentExecutor). */
async function signPayloads(
  vault: VaultBase,
  ctx: CommandContext,
  params: PolymarketBuyParams,
  payloads: unknown[]
): Promise<SignatureEntry[]> {
  const executor = new AgentExecutor(vault, !!params.verbose, vault.publicKeys.ecdsa, ctx.sdk)
  if (params.password) executor.setPassword(params.password)
  const action = await executor.signTypedData('pm-spike', { payloads })
  if (!action.success) {
    throw new Error(`sign_typed_data failed: ${JSON.stringify(action.data)}`)
  }
  const sigs = (action.data as { signatures?: SignatureEntry[] }).signatures
  if (!sigs || sigs.length === 0) throw new Error('sign_typed_data returned no signatures')
  return sigs
}
