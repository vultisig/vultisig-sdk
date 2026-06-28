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
import { AgentErrorCode, normalizeAgentError } from '../agent/agentErrors'
import type { AskResult } from '../agent/ask'
import { renderBalanceSummaryCard } from '../agent/cards'
import type { CommandContext } from '../core'
import { isJsonOutput, outputErrorJson, outputJson, printResult, setSilentMode } from '../lib/output'

export type AgentCommandOptions = {
  backendUrl?: string
  password?: string
  viaAgent?: boolean
  sessionId?: string
  verbose?: boolean
  notificationUrl?: string
  profile?: string
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

/**
 * Render a human-readable (non-JSON) ask result to stdout: session line, optional
 * confirmation/proposed lines, balance cards, response text, and tx hashes.
 */
function outputAskHuman(result: AskResult, confirmationRequired: boolean, proposed: string | undefined): void {
  // Line 1: session ID (easily extractable with head -1 | cut -d: -f2-)
  process.stdout.write(`session:${result.sessionId}\n`)
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
      ...(confirmationRequired ? { confirmation_required: true } : {}),
      ...(proposed ? { proposed } : {}),
    })
    return
  }
  outputAskHuman(result, confirmationRequired, proposed)
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
      exitCode = 1
      outputAskError(wantsJson, result.error.message, result.error.code, conversationId, result)
    } else {
      outputAskSuccess(wantsJson, result, conversationId)
    }
  } catch (err: unknown) {
    const { code, message } = normalizeAgentError(err)
    exitCode = 1
    // ask() can throw AFTER a tx already broadcast: a successful sign always
    // triggers a recursive follow-up request to report recent_actions, and an
    // HTTP/timeout/5xx failure there rejects sendMessage. Recover the partial
    // turn so the broadcast hash still reaches the error envelope (and use the
    // session's conversation id, already assigned during initialize) instead of
    // stranding the funds with exit-1 and an empty record.
    const partial = ask?.partialResult()
    if (partial && !conversationId) conversationId = partial.sessionId
    outputAskError(wantsJson, message, code, conversationId, partial)
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
