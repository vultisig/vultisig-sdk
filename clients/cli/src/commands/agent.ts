/**
 * Agent Command - AI-powered chat interface for wallet operations
 *
 * Modes:
 * - `vultisig agent` - Interactive TUI with IRC-style chat (new session)
 * - `vultisig agent --session-id <id>` - Resume existing session
 * - `vultisig agent --via-agent` - NDJSON pipe for agent-to-agent communication
 * - `vultisig agent ask <message>` - One-shot command for AI coding agents
 *
 * Session management:
 * - `vultisig agent sessions list` - List sessions for current vault
 * - `vultisig agent sessions delete <id>` - Delete a session
 */
import type { VaultBase } from '@vultisig/sdk'
import chalk from 'chalk'
import Table from 'cli-table3'

import type { AgentConfig } from '../agent'
import {
  AgentClient,
  AgentSession,
  AskInterface,
  authenticateVault,
  ChatTUI,
  isAuthError,
  PipeInterface,
} from '../agent'
import { AgentErrorCode, agentErrorCodeToExitCode, normalizeAgentError } from '../agent/agentErrors'
import type { AskResult } from '../agent/ask'
import { renderBalanceSummaryCard } from '../agent/cards'
import type { CommandContext } from '../core'
import { ExitCode } from '../core/errors'
import { isJsonOutput, outputErrorJson, outputJson, printResult, setSilentMode } from '../lib/output'

export type AgentCommandOptions = {
  backendUrl?: string
  password?: string
  viaAgent?: boolean
  sessionId?: string
  verbose?: boolean
  notificationUrl?: string
  profile?: string
  allowAutoSubmit?: boolean
}

export async function executeAgent(ctx: CommandContext, options: AgentCommandOptions): Promise<void> {
  const vault = await ctx.ensureActiveVault()

  const config: AgentConfig = {
    backendUrl: options.backendUrl || process.env.VULTISIG_AGENT_URL || 'https://abe.vultisig.com',
    vaultName: vault.name,
    vultisig: ctx.sdk,
    password: options.password,
    viaAgent: options.viaAgent,
    sessionId: options.sessionId,
    verbose: options.verbose,
    notificationUrl: options.notificationUrl || process.env.VULTISIG_NOTIFICATION_URL || '',
    profile: options.profile ?? process.env.VULTISIG_AGENT_PROFILE ?? '',
    allowAutoSubmit: options.allowAutoSubmit,
  }

  const session = new AgentSession(vault, config)

  if (options.viaAgent) {
    // Pipe mode for agent-to-agent communication
    const pipe = new PipeInterface(session)
    const callbacks = pipe.getCallbacks()

    try {
      await session.initialize(callbacks)
      const addresses = session.getVaultAddresses()
      await pipe.start(vault.name, addresses)
    } catch (err: unknown) {
      const { code, message } = normalizeAgentError(err)
      process.stdout.write(JSON.stringify({ type: 'error', message, code }) + '\n')
      process.exit(1)
    }
  } else {
    // Interactive TUI mode
    const tui = new ChatTUI(session, vault.name, config.verbose)
    const callbacks = tui.getCallbacks()

    try {
      await session.initialize(callbacks)
      await tui.start()
    } catch (err: unknown) {
      const { message } = normalizeAgentError(err)
      console.error(`Agent error: ${message}`)
      process.exit(1)
    }
  }
}

// ============================================================================
// Ask Mode (one-shot for AI coding agents)
// ============================================================================

export type AgentAskOptions = {
  backendUrl?: string
  password?: string
  session?: string
  verbose?: boolean
  json?: boolean
  profile?: string
  /** Opt in to unattended signing/broadcast (`--yes`). Default: deny + report the proposed tx. */
  autoApprove?: boolean
  /** Permit the backend to submit a signed Polymarket order. */
  allowAutoSubmit?: boolean
  /** Bypass the broadcast-journal duplicate guard (`--force`). */
  force?: boolean
}

/**
 * Send a single message to the agent and output the response.
 * Designed for AI coding agents (Claude Code, Opencode, Cursor, etc.)
 * that execute shell commands and read stdout.
 *
 * Output format (text):
 *   session:<conversation-id>
 *   <blank line>
 *   <response text>
 *
 * Output format (--json): a single v1 envelope on stdout for both success and
 * error.
 *   success: {"success":true,"v":1,"data":{"conversation_id":"...","response":"...",...}}
 *   error:   {"success":false,"v":1,"error":{"message":"...","code":"...","conversation_id":"..."}}
 */
/**
 * Write the structured error envelope to stdout (JSON mode) or a human line to
 * stderr. Shared by the mid-turn `error`-frame path and the catch path so both
 * surface the same shape and a headless caller can branch on it identically.
 *
 * When a `result` is supplied (the mid-turn `error`-frame path), any tx records
 * already broadcast this turn — plus the partial response/tool_calls — are
 * carried in a `data` block alongside the error. A turn can broadcast a tx and
 * THEN hit an `error` frame (e.g. an indexer/confirmation failure); dropping the
 * hash there would strand funds a headless caller just moved, leaving exit-1 with
 * no identifier to track/recover/de-dupe the send. The block is only attached
 * when non-empty, so the catch path (auth/init failure, no broadcast) keeps the
 * lean `{message,code,conversation_id}` error shape.
 */
function outputAskError(
  wantsJson: boolean,
  message: string,
  code: AgentErrorCode,
  conversationId: string,
  result?: AskResult
): void {
  if (wantsJson) {
    const data: Record<string, unknown> = {}
    if (result?.transactions.length) data.transactions = result.transactions
    if (result?.toolCalls.length) data.tool_calls = result.toolCalls
    if (result?.response) data.response = result.response
    if (result?.warnings.length) data.warnings = result.warnings
    // a2a-02: the typed turn ending, when the backend advertised it. Placed under
    // `data` so a caller reads `data.outcome` on BOTH the success and error
    // envelopes (the success envelope wraps its fields under `data` via outputJson).
    if (result?.outcome) data.outcome = result.outcome
    outputErrorJson({
      success: false,
      v: 1,
      error: { message, code, conversation_id: conversationId },
      ...(Object.keys(data).length > 0 ? { data } : {}),
    })
  } else {
    process.stderr.write(`Error: ${message} [${code}]\n`)
  }
}

type PostBroadcastCode = AgentErrorCode.ACK_FAILED | AgentErrorCode.BROADCAST_COMMITTED

const BROADCAST_COMMITTED_MESSAGE =
  'A transaction was broadcast, but the overall agent request may be incomplete. Inspect the transaction status before continuing.'
const ACK_FAILED_MESSAGE =
  'A transaction was broadcast, but its post-broadcast report failed. Inspect the transaction status before continuing.'

function hasCommittedBroadcast(result: AskResult | undefined): boolean {
  return !!result?.transactions.some(tx => tx.hash.trim().length > 0 && tx.status !== 'failed')
}

/**
 * Override a later backend/conversational failure after an on-chain submission.
 * This stays non-zero because the overall request may be partial, but is explicitly
 * non-retryable so automation cannot mistake the original failure for permission to
 * replay a send, approval, or another leg of a compound flow.
 */
function outputPostBroadcastFailure(
  wantsJson: boolean,
  result: AskResult,
  conversationId: string,
  classification: PostBroadcastCode,
  originalError?: { message: string; code: AgentErrorCode }
): void {
  const message = classification === AgentErrorCode.ACK_FAILED ? ACK_FAILED_MESSAGE : BROADCAST_COMMITTED_MESSAGE
  if (wantsJson) {
    const data: Record<string, unknown> = {
      transactions: result.transactions,
      tool_calls: result.toolCalls,
      response: result.response,
      ...(result.warnings.length ? { warnings: result.warnings } : {}),
      ...(result.outcome ? { outcome: result.outcome } : {}),
      ...(originalError ? { original_error: originalError } : {}),
    }
    outputErrorJson({
      success: false,
      v: 1,
      error: { message, code: classification, conversation_id: conversationId },
      data,
    })
    return
  }

  const label =
    classification === AgentErrorCode.ACK_FAILED ? 'Broadcast acknowledgement failed' : 'Broadcast committed'
  process.stderr.write(`session:${result.sessionId}\n`)
  process.stderr.write(`${label}: ${message}\n`)
  if (result.outcome) {
    const { kind, code } = result.outcome
    process.stderr.write(`outcome:${kind}${code ? `:${code}` : ''}\n`)
  }
  if (originalError) {
    process.stderr.write(`backend-error:${originalError.message} [${originalError.code}]\n`)
  }
  for (const tx of result.transactions) {
    process.stderr.write(`tx:${tx.chain}:${tx.hash}\n`)
    process.stderr.write(`status:${tx.status ?? 'unknown'}\n`)
    if (tx.explorerUrl) process.stderr.write(`explorer:${tx.explorerUrl}\n`)
  }
  process.stderr.write(
    'WARNING: DO NOT blindly retry. Verify each transaction hash and continue only the incomplete step.\n'
  )
}

/**
 * Render a human-readable (non-JSON) ask result to stdout: session line, optional
 * confirmation/proposed lines, balance cards, response text, and tx hashes.
 */
function outputAskHuman(result: AskResult, confirmationRequired: boolean, proposed: string | undefined): void {
  // Line 1: session ID (easily extractable with head -1 | cut -d: -f2-)
  process.stdout.write(`session:${result.sessionId}\n`)
  // a2a-02: surface a non-success turn ending as a greppable line (matches the exit
  // code). Success is the norm and needs no line — the response speaks for itself.
  if (result.outcome && result.outcome.kind !== 'success') {
    const { kind, code } = result.outcome
    process.stdout.write(`outcome:${kind}${code ? `:${code}` : ''}\n`)
  }
  if (confirmationRequired) {
    process.stdout.write(`confirmation-required:pass --yes to authorize signing\n`)
    if (proposed) {
      process.stdout.write(`proposed:${proposed}\n`)
    }
  }
  // Balance cards (rendered as a table instead of raw JSON)
  for (const card of result.cards) {
    process.stdout.write(`\n${renderBalanceSummaryCard(card)}\n`)
  }
  // Response text
  if (result.response) {
    process.stdout.write(`\n${result.response}\n`)
  }
  // Transaction hashes
  for (const tx of result.transactions) {
    process.stdout.write(`\ntx:${tx.chain}:${tx.hash}\n`)
    if (tx.explorerUrl) {
      process.stdout.write(`explorer:${tx.explorerUrl}\n`)
    }
  }
}

/**
 * Emit a successful ask turn — the structured JSON envelope (JSON mode) or the
 * human rendering. Computes the confirmation-required / proposed signals once.
 */
function outputAskSuccess(wantsJson: boolean, result: AskResult, conversationId: string): void {
  // Machine-detectable signal that a signing step was proposed but denied (no
  // --yes): callers expecting a broadcast must check this, not infer from exit 0.
  const confirmationRequired = result.toolCalls.some(tc => tc.code === AgentErrorCode.CONFIRMATION_REQUIRED)
  // The same summary the gate showed the user (or would have, in --yes mode).
  const proposedCall = result.toolCalls.find(
    tc => tc.code === AgentErrorCode.CONFIRMATION_REQUIRED && typeof tc.data?.proposed === 'string'
  )
  const proposed = proposedCall?.data?.proposed as string | undefined

  if (wantsJson) {
    outputJson({
      conversation_id: conversationId,
      session_id: result.sessionId,
      response: result.response,
      tool_calls: result.toolCalls,
      transactions: result.transactions,
      ...(result.cards.length > 0 ? { cards: result.cards } : {}),
      ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
      // a2a-02: the typed turn ending (success | blocked | refusal | error) at
      // `data.outcome` — the same relative slot as on the error envelope. Present
      // only against a backend that honored the advertised turn_outcome surface;
      // headless callers should branch on this (and the exit code), not `success`
      // (which stays true for a completed-but-blocked/refused turn).
      ...(result.outcome ? { outcome: result.outcome } : {}),
      ...(confirmationRequired ? { confirmation_required: true } : {}),
      ...(proposed ? { proposed } : {}),
    })
    return
  }
  outputAskHuman(result, confirmationRequired, proposed)
}

/**
 * Map a typed turn-outcome to an exit code (a2a-02). STRICTLY ADDITIVE to the #952
 * taxonomy: success stays 0; blocked/refusal take the first free dedicated slots
 * (10/11); an infra error with no dedicated stream `error` frame collapses to the
 * generic failure code (1) so it can't read as a false success. Returns undefined
 * when there is no outcome (older backend) so the caller keeps its prior default.
 */
function outcomeToExitCode(outcome: AskResult['outcome']): ExitCode | undefined {
  switch (outcome?.kind) {
    case 'blocked':
      return ExitCode.AGENT_TURN_BLOCKED
    case 'refusal':
      return ExitCode.AGENT_TURN_REFUSAL
    case 'error':
      return ExitCode.USAGE // 1 — generic failure; a stream error-frame path sets a more specific code first
    case 'success':
      return ExitCode.SUCCESS
    default:
      return undefined
  }
}

export async function executeAgentAsk(ctx: CommandContext, message: string, options: AgentAskOptions): Promise<void> {
  // Suppress info/warn/success messages — only our structured output goes to stdout
  setSilentMode(true)

  // Redirect console.log to stderr so that SDK internals (MPC signing progress,
  // balance updates, etc.) don't pollute our structured stdout output. The
  // structured envelope itself is written via outputJson/outputErrorJson, which
  // go straight to process.stdout and so survive this redirect.
  const originalConsoleLog = console.log
  console.log = (...args: unknown[]) => {
    process.stderr.write(args.map(String).join(' ') + '\n')
  }

  const wantsJson = !!options.json || isJsonOutput()
  // Captured after ask() so both the success and error paths can attach it; the
  // catch may run before it's set (auth/init failure), leaving it empty.
  let conversationId = ''
  let exitCode = 0
  // Hoisted so the catch can recover partial turn state (already-broadcast tx
  // hashes) when ask() throws AFTER a broadcast — see the catch block below.
  let ask: AskInterface | undefined

  try {
    const vault = await ctx.ensureActiveVault()

    const config: AgentConfig = {
      backendUrl: options.backendUrl || process.env.VULTISIG_AGENT_URL || 'https://abe.vultisig.com',
      vaultName: vault.name,
      vultisig: ctx.sdk,
      password: options.password,
      sessionId: options.session,
      verbose: options.verbose,
      askMode: true,
      profile: options.profile ?? process.env.VULTISIG_AGENT_PROFILE ?? '',
      force: options.force,
      allowAutoSubmit: options.allowAutoSubmit,
    }

    const session = new AgentSession(vault, config)
    ask = new AskInterface(session, !!config.verbose, !!options.autoApprove)
    const callbacks = ask.getCallbacks()

    await session.initialize(callbacks)
    const result = await ask.ask(message)
    conversationId = result.sessionId

    // A backend/stream `error` frame mid-turn resolves the turn normally (the
    // SSE handler only calls onError), so without this check a headless caller
    // branching on exit code would see false success. Surface it as the error
    // envelope on stdout and exit non-zero; otherwise emit the success turn.
    if (result.error) {
      // Once a live transaction hash exists, a later stream/backend error is a
      // non-retryable partial success, not an ordinary retryable failure. Keep the
      // original diagnostic under data.original_error for investigation.
      if (hasCommittedBroadcast(result)) {
        exitCode = ExitCode.BROADCAST_COMMITTED
        outputPostBroadcastFailure(wantsJson, result, conversationId, AgentErrorCode.BROADCAST_COMMITTED, result.error)
      } else {
        // Map the backend/stream error code onto the ExitCode taxonomy (F3) so a
        // headless caller can branch on `$?` — a retryable network blip vs a
        // definitive bad-input vs an auth failure — instead of a blanket 1.
        exitCode = agentErrorCodeToExitCode(result.error.code)
        outputAskError(wantsJson, result.error.message, result.error.code, conversationId, result)
      }
    } else if (hasCommittedBroadcast(result) && result.outcome && result.outcome.kind !== 'success') {
      // Any typed non-success ending can arrive after an approval/send/swap leg
      // already landed. Do not turn that partial execution into overall success or
      // claim that a refusal/clarification means no action was taken.
      exitCode = ExitCode.BROADCAST_COMMITTED
      outputPostBroadcastFailure(wantsJson, result, conversationId, AgentErrorCode.BROADCAST_COMMITTED)
    } else {
      // a2a-02: no stream error frame — the turn ending is the typed turn_outcome
      // (when the backend emitted one). success→0, blocked→10, refusal→11, a
      // frame-less error→1. Absent outcome (older backend) keeps the prior exit 0.
      exitCode = outcomeToExitCode(result.outcome) ?? 0
      outputAskSuccess(wantsJson, result, conversationId)
    }
  } catch (err: unknown) {
    const normalized = normalizeAgentError(err)
    const code = normalized.code
    const message = normalized.message
    // ask() can throw AFTER a tx already broadcast: a successful sign always
    // triggers a recursive follow-up request to report recent_actions, and an
    // HTTP/timeout/5xx failure there rejects sendMessage. Recover the partial
    // turn so the broadcast hash still reaches the error envelope (and use the
    // session's conversation id, already assigned during initialize) instead of
    // stranding the funds with exit-1 and an empty record.
    const partial = ask?.partialResult()
    if (partial && !conversationId) conversationId = partial.sessionId
    // A throw after any live transaction surfaced is the same partial-success
    // safety boundary as a returned stream/typed error. The original throw remains
    // available as data.original_error, but the public classification must tell
    // automation to inspect the hash rather than replay the entire request.
    if (partial && hasCommittedBroadcast(partial)) {
      // Preserve the established ACK_FAILED/8 contract for the exact case where
      // the immediate post-broadcast report is still undelivered. The additive
      // BROADCAST_COMMITTED/13 classification covers broader later failures.
      const classification = ask?.hasUnacknowledgedBroadcast()
        ? AgentErrorCode.ACK_FAILED
        : AgentErrorCode.BROADCAST_COMMITTED
      exitCode = agentErrorCodeToExitCode(classification)
      outputPostBroadcastFailure(wantsJson, partial, conversationId, classification, { message, code })
    } else {
      exitCode = agentErrorCodeToExitCode(code)
      outputAskError(wantsJson, message, code, conversationId, partial)
    }
  } finally {
    console.log = originalConsoleLog
    setSilentMode(false)
  }

  // Clean exit — don't leave dangling handles. Non-zero on a backend/stream
  // error so headless callers can branch on exit code.
  process.exit(exitCode)
}

// ============================================================================
// Session Management
// ============================================================================

export type AgentSessionsListOptions = {
  backendUrl?: string
  password?: string
}

export async function executeAgentSessionsList(ctx: CommandContext, options: AgentSessionsListOptions): Promise<void> {
  const vault = await ctx.ensureActiveVault()
  const backendUrl = options.backendUrl || process.env.VULTISIG_AGENT_URL || 'https://abe.vultisig.com'
  const client = await createAuthenticatedClient(backendUrl, vault, options.password)

  const publicKey = vault.publicKeys.ecdsa

  // Fetch all pages (backend caps at 100 per request)
  const PAGE_SIZE = 100
  const allConversations: Awaited<ReturnType<typeof client.listConversations>>['conversations'] = []
  let totalCount = 0
  let skip = 0

  while (true) {
    const page = await withClientAuthRetry(client, vault, options.password, () =>
      client.listConversations(publicKey, skip, PAGE_SIZE)
    )
    totalCount = page.total_count
    allConversations.push(...page.conversations)
    if (allConversations.length >= totalCount || page.conversations.length < PAGE_SIZE) break
    skip += PAGE_SIZE
  }

  if (isJsonOutput()) {
    outputJson({
      sessions: allConversations.map(c => ({
        id: c.id,
        title: c.title,
        created_at: c.created_at,
        updated_at: c.updated_at,
      })),
      total_count: totalCount,
    })
    return
  }

  if (allConversations.length === 0) {
    printResult('No sessions found.')
    return
  }

  const table = new Table({
    head: [chalk.cyan('ID'), chalk.cyan('Title'), chalk.cyan('Created'), chalk.cyan('Updated')],
  })

  for (const conv of allConversations) {
    table.push([
      conv.id,
      conv.title || chalk.gray('(untitled)'),
      formatDate(conv.created_at),
      formatDate(conv.updated_at),
    ])
  }

  printResult(table.toString())
  printResult(chalk.gray(`\n  ${totalCount} session(s) total`))
}

export type AgentSessionsDeleteOptions = {
  backendUrl?: string
  password?: string
}

export async function executeAgentSessionsDelete(
  ctx: CommandContext,
  sessionId: string,
  options: AgentSessionsDeleteOptions
): Promise<void> {
  const vault = await ctx.ensureActiveVault()
  const backendUrl = options.backendUrl || process.env.VULTISIG_AGENT_URL || 'https://abe.vultisig.com'
  const client = await createAuthenticatedClient(backendUrl, vault, options.password)

  const publicKey = vault.publicKeys.ecdsa
  await withClientAuthRetry(client, vault, options.password, () => client.deleteConversation(sessionId, publicKey))

  if (isJsonOutput()) {
    outputJson({ deleted: sessionId })
    return
  }

  printResult(chalk.green(`Session ${sessionId} deleted.`))
}

// ============================================================================
// Helpers
// ============================================================================

async function createAuthenticatedClient(
  backendUrl: string,
  vault: VaultBase,
  password?: string
): Promise<AgentClient> {
  const client = new AgentClient(backendUrl)
  const auth = await authenticateVault(client, vault, password)
  client.setAuthToken(auth.token)
  return client
}

/**
 * Run an authenticated request and, on a 401/403, re-auth + retry once. Mirrors
 * AgentSession.withAuthRetry for the cache-free `agent sessions` commands so a
 * token revoked between createAuthenticatedClient and the list/delete call
 * recovers instead of surfacing a raw auth error.
 */
export async function withClientAuthRetry<T>(
  client: AgentClient,
  vault: VaultBase,
  password: string | undefined,
  request: () => Promise<T>
): Promise<T> {
  try {
    return await request()
  } catch (err) {
    if (!isAuthError(err)) throw err
    const auth = await authenticateVault(client, vault, password)
    client.setAuthToken(auth.token)
    return await request()
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}
