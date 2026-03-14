/**
 * Agent Command - AI-powered chat interface for wallet operations
 *
 * Two modes:
 * - `vultisig agent` - Interactive TUI with IRC-style chat
 * - `vultisig agent --via-agent` - NDJSON pipe for agent-to-agent communication
 */
import type { CommandContext } from '../core'
import { AgentSession, ChatTUI, PipeInterface } from '../agent'
import type { AgentConfig } from '../agent'

export type AgentCommandOptions = {
  backendUrl?: string
  password?: string
  viaAgent?: boolean
  conversationId?: string
}

export async function executeAgent(ctx: CommandContext, options: AgentCommandOptions): Promise<void> {
  const vault = await ctx.ensureActiveVault()

  const config: AgentConfig = {
    backendUrl: options.backendUrl || process.env.VULTISIG_AGENT_URL || 'http://localhost:9998',
    vaultName: vault.name,
    password: options.password,
    viaAgent: options.viaAgent,
    conversationId: options.conversationId,
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
    const tui = new ChatTUI(session, vault.name)
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
