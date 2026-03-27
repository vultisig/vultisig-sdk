/**
 * Agent Chat Module
 *
 * Provides AI-powered conversational interface for wallet operations.
 * Supports three modes:
 * - TUI (human): IRC-style interactive chat
 * - Pipe (--via-agent): NDJSON over stdin/stdout for agent consumption
 * - Ask (agent ask): One-shot command for AI coding agents
 */
export type { AskResult } from './ask'
export { AskInterface } from './ask'
export { authenticateVault } from './auth'
export { AgentClient } from './client'
export { buildMessageContext, buildMinimalContext } from './context'
export { AgentExecutor } from './executor'
export { PipeInterface } from './pipe'
export { AgentSession } from './session'
export { ChatTUI } from './tui'
export type { AgentConfig, PipeInputCommand, PipeOutputEvent, UICallbacks } from './types'
