/**
 * Agent Chat Module
 *
 * Provides AI-powered conversational interface for wallet operations.
 * Supports two modes:
 * - TUI (human): IRC-style interactive chat
 * - Pipe (--via-agent): NDJSON over stdin/stdout for agent consumption
 */
export { AgentClient } from './client'
export { authenticateVault } from './auth'
export { buildMessageContext, buildMinimalContext } from './context'
export { AgentExecutor } from './executor'
export { AgentSession } from './session'
export { ChatTUI } from './tui'
export { PipeInterface } from './pipe'
export type { AgentConfig, UICallbacks, PipeOutputEvent, PipeInputCommand } from './types'
