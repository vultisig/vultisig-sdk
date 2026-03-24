/**
 * Agent Command - AI-powered chat interface for wallet operations
 *
 * Modes:
 * - `vultisig agent` - Interactive TUI with IRC-style chat (new session)
 * - `vultisig agent --session-id <id>` - Resume existing session
 * - `vultisig agent --via-agent` - NDJSON pipe for agent-to-agent communication
 *
 * Session management:
 * - `vultisig agent sessions list` - List sessions for current vault
 * - `vultisig agent sessions delete <id>` - Delete a session
 */
import type { VaultBase } from '@vultisig/sdk'
import chalk from 'chalk'
import Table from 'cli-table3'

import type { AgentConfig } from '../agent'
import { AgentClient, AgentSession, authenticateVault, ChatTUI, PipeInterface } from '../agent'
import type { CommandContext } from '../core'
import { isJsonOutput, outputJson, printResult } from '../lib/output'

export type AgentCommandOptions = {
  backendUrl?: string
  password?: string
  viaAgent?: boolean
  sessionId?: string
  verbose?: boolean
}

export async function executeAgent(ctx: CommandContext, options: AgentCommandOptions): Promise<void> {
  const vault = await ctx.ensureActiveVault()

  const config: AgentConfig = {
    backendUrl: options.backendUrl || process.env.VULTISIG_AGENT_URL || 'http://localhost:9998',
    vaultName: vault.name,
    password: options.password,
    viaAgent: options.viaAgent,
    sessionId: options.sessionId,
    verbose: options.verbose,
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
// Session Management
// ============================================================================

export type AgentSessionsListOptions = {
  backendUrl?: string
  password?: string
}

export async function executeAgentSessionsList(ctx: CommandContext, options: AgentSessionsListOptions): Promise<void> {
  const vault = await ctx.ensureActiveVault()
  const backendUrl = options.backendUrl || process.env.VULTISIG_AGENT_URL || 'http://localhost:9998'
  const client = await createAuthenticatedClient(backendUrl, vault, options.password)

  const publicKey = vault.publicKeys.ecdsa

  // Fetch all pages (backend caps at 100 per request)
  const PAGE_SIZE = 100
  const allConversations: Awaited<ReturnType<typeof client.listConversations>>['conversations'] = []
  let totalCount = 0
  let skip = 0

  // eslint-disable-next-line no-constant-condition
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
  const backendUrl = options.backendUrl || process.env.VULTISIG_AGENT_URL || 'http://localhost:9998'
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

async function createAuthenticatedClient(backendUrl: string, vault: VaultBase, password?: string): Promise<AgentClient> {
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
