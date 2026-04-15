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
import { AgentClient, AgentSession, AskInterface, authenticateVault, ChatTUI, PipeInterface } from '../agent'
import type { CommandContext } from '../core'
import { isJsonOutput, outputJson, printResult, setSilentMode } from '../lib/output'

export type AgentCommandOptions = {
  backendUrl?: string
  password?: string
  viaAgent?: boolean
  sessionId?: string
  verbose?: boolean
  notificationUrl?: string
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
    } catch (err: any) {
      process.stdout.write(JSON.stringify({ type: 'error', message: err.message }) + '\n')
      process.exit(1)
    }
  } else {
    // Interactive TUI mode
    const tui = new ChatTUI(session, vault.name, config.verbose)
    const callbacks = tui.getCallbacks()

    try {
      await session.initialize(callbacks)
      await tui.start()
    } catch (err: any) {
      console.error(`Agent error: ${err.message}`)
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
 * Output format (--json):
 *   {"session_id":"...","response":"...","tool_calls":[...],"transactions":[...]}
 */
export async function executeAgentAsk(ctx: CommandContext, message: string, options: AgentAskOptions): Promise<void> {
  // Suppress info/warn/success messages — only our structured output goes to stdout
  setSilentMode(true)

  // Redirect console.log to stderr so that SDK internals (MPC signing progress,
  // balance updates, etc.) don't pollute our structured stdout output.
  const originalConsoleLog = console.log
  console.log = (...args: unknown[]) => {
    process.stderr.write(args.map(String).join(' ') + '\n')
  }

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
    }

    const session = new AgentSession(vault, config)
    const ask = new AskInterface(session, !!config.verbose)
    const callbacks = ask.getCallbacks()

    await session.initialize(callbacks)
    const result = await ask.ask(message)

    if (options.json) {
      process.stdout.write(
        JSON.stringify({
          session_id: result.sessionId,
          response: result.response,
          tool_calls: result.toolCalls,
          transactions: result.transactions,
        }) + '\n'
      )
    } else {
      // Line 1: session ID (easily extractable with head -1 | cut -d: -f2-)
      process.stdout.write(`session:${result.sessionId}\n`)

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
  } catch (err: any) {
    if (options.json) {
      process.stdout.write(JSON.stringify({ error: err.message }) + '\n')
    } else {
      process.stderr.write(`Error: ${err.message}\n`)
    }
    process.exit(1)
  } finally {
    console.log = originalConsoleLog
    setSilentMode(false)
  }

  // Clean exit — don't leave dangling handles
  process.exit(0)
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
    const page = await client.listConversations(publicKey, skip, PAGE_SIZE)
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
  await client.deleteConversation(sessionId, publicKey)

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

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}
