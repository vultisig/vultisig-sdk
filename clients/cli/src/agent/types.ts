/**
 * Agent Chat - Type Definitions
 *
 * Types for the agent chat system including SSE events,
 * backend API types, action execution, and UI interfaces.
 */
import type { Vultisig } from '@vultisig/sdk'

import type { AgentErrorCode } from './agentErrors'

// ============================================================================
// Configuration
// ============================================================================

export type AgentConfig = {
  backendUrl: string
  vaultName?: string
  /** SDK instance that owns the vault (address book and other global state) */
  vultisig?: Vultisig
  password?: string
  /** Skip TUI, use NDJSON pipe interface */
  viaAgent?: boolean
  /** One-shot ask mode for AI coding agents */
  askMode?: boolean
  /** Session ID to resume */
  sessionId?: string
  /** Show detailed tool call params and debug output */
  verbose?: boolean
  /** Notification service URL for push notifications (empty = disabled) */
  notificationUrl?: string
}

// ============================================================================
// Backend API Types
// ============================================================================

export type AuthTokenRequest = {
  public_key: string
  chain_code_hex: string
  message: string
  signature: string
}

export type AuthTokenResponse = {
  token: string
  expires_at: number
}

export type CreateConversationRequest = {
  public_key: string
}

export type CreateConversationResponse = {
  id: string
  public_key: string
  title: string | null
  created_at: string
  updated_at: string
}

export type ListConversationsRequest = {
  public_key: string
  skip?: number
  take?: number
}

export type ListConversationsResponse = {
  conversations: ConversationSummary[]
  total_count: number
}

export type ConversationSummary = {
  id: string
  public_key: string
  title: string | null
  created_at: string
  updated_at: string
}

export type GetConversationRequest = {
  public_key: string
}

export type GetConversationResponse = {
  id: string
  public_key: string
  title: string | null
  summary?: string
  summary_up_to?: string
  vault_info?: {
    ecdsa_public_key: string
    eddsa_public_key: string
    chain_code: string
  }
  created_at: string
  updated_at: string
  messages: ConversationMessage[]
}

export type ConversationMessage = {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  content_type: 'text' | 'audio_url' | 'action_result'
  audio_url?: string
  metadata?: Record<string, unknown>
  created_at: string
}

// ============================================================================
// Message Context (sent with each message)
// ============================================================================

export type MessageContext = {
  vault_address?: string
  vault_name?: string
  mldsa_public_key?: string
  balances?: BalanceInfo[]
  addresses?: Record<string, string>
  coins?: CoinInfo[]
  address_book?: AddressBookEntry[]
  /**
   * Client-side tool results from the previous turn, flushed on the next
   * outbound request. Replaces the legacy top-level `action_result` field
   * (post-PR-#119 contract). Backend reads these as tool outputs for the
   * LLM's next iteration.
   */
  recent_actions?: RecentAction[]
}

/**
 * Result of a client-side tool call the CLI executed locally. Sent back
 * to the backend in `context.recent_actions` on the next HTTP round-trip
 * so the LLM can see the outcome.
 */
export type RecentAction = {
  tool: string
  success: boolean
  data?: Record<string, unknown>
}

export type BalanceInfo = {
  chain: string
  asset: string
  symbol: string
  amount: string
  decimals: number
}

export type CoinInfo = {
  chain: string
  ticker: string
  contract_address?: string
  is_native_token: boolean
  decimals: number
  logo?: string
}

export type AddressBookEntry = {
  title: string
  address: string
  chain: string
}

// ============================================================================
// Send Message
// ============================================================================

export type SendMessageRequest = {
  public_key: string
  content?: string
  context?: MessageContext
  tools?: ToolDefinition[]
  selected_suggestion_id?: string
  /** Signals that the caller is an AI agent; backend adjusts prompt accordingly */
  via_agent?: boolean
}

export type ToolDefinition = {
  name: string
  params: string
}

export type SendMessageResponse = {
  message: ConversationMessage
  title?: string
  suggestions?: Suggestion[]
  actions?: Action[]
  policy_ready?: PolicyReady
  install_required?: InstallRequired
  transactions?: Array<Transaction | TxReadyPayload>
  tokens?: TokenSearchResult
  usage?: UsageInfo
}

export type Suggestion = {
  id: string
  plugin_id?: string
  title: string
  description?: string
}

export type Action = {
  id: string
  type: string
  title: string
  description?: string
  params?: Record<string, unknown>
  auto_execute?: boolean
}

export type PolicyReady = {
  plugin_id: string
  configuration: Record<string, unknown>
  policy_suggest?: Record<string, unknown>
}

export type InstallRequired = {
  plugin_id: string
  title: string
  description?: string
}

/**
 * Summary transaction row from non-streaming JSON responses.
 *
 * Permissive tx_ready payload shape while the backend schema evolves.
 * TODO: replace with a concrete interface or union when tx_ready stabilizes.
 */
export type TxReadyPayloadFields = Record<string, unknown>

export type Transaction = {
  sequence: number
  chain: string
  chain_id?: string
  action: string
  signing_mode: string
  unsigned_tx_hex?: string
  tx_details?: Record<string, unknown>
  keysign_payload?: string
  /** Server-built swap payload on tx_ready SSE */
  swap_tx?: TxReadyPayloadFields
  /** Server-built send payload on tx_ready SSE */
  send_tx?: TxReadyPayloadFields
  /** Generic server-built tx on tx_ready SSE */
  tx?: TxReadyPayloadFields
}

/**
 * SSE `tx_ready` payload — backend may nest swap/send payloads or attach `tx`.
 * Kept separate from {@link Transaction} so optional nested fields type-check.
 */
export type TxReadyPayload = {
  sequence?: number
  chain?: string
  chain_id?: string
  action?: string
  signing_mode?: string
  unsigned_tx_hex?: string
  tx_details?: Record<string, unknown>
  keysign_payload?: string
  swap_tx?: Record<string, unknown>
  send_tx?: Record<string, unknown>
  tx?: Record<string, unknown>
}

export type TokenSearchResult = {
  tokens: TokenInfo[]
}

export type TokenInfo = {
  id: string
  name: string
  symbol: string
  market_cap_rank?: number
  logo?: string
  deployments?: Array<{
    chain: string
    contract_address: string
    decimals: number
  }>
}

export type UsageInfo = {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  ai_call_count: number
}

// ============================================================================
// SSE Event Types
// ============================================================================

export type SSETextDelta = { delta: string }
export type SSEToolProgress = { tool: string; status: 'running' | 'done'; label?: string }
export type SSETitle = { title: string }
export type SSEActions = { actions: Action[] }
export type SSESuggestions = { suggestions: Suggestion[] }
export type SSETxReady = TxReadyPayload
export type SSEPolicyReady = PolicyReady
export type SSEInstallRequired = InstallRequired
export type SSEMessage = { message: ConversationMessage }
export type SSEError = { error: string }

export type SSEEvent =
  | { type: 'text_delta'; data: SSETextDelta }
  | { type: 'tool_progress'; data: SSEToolProgress }
  | { type: 'title'; data: SSETitle }
  | { type: 'actions'; data: SSEActions }
  | { type: 'suggestions'; data: SSESuggestions }
  | { type: 'tx_ready'; data: SSETxReady }
  | { type: 'policy_ready'; data: SSEPolicyReady }
  | { type: 'install_required'; data: SSEInstallRequired }
  | { type: 'message'; data: SSEMessage }
  | { type: 'error'; data: SSEError }
  | { type: 'done'; data: Record<string, never> }

// ============================================================================
// Action Execution
// ============================================================================

export type ActionResult = {
  action: string
  action_id: string
  success: boolean
  data?: Record<string, unknown>
  error?: string
  /** Present when success is false */
  code?: AgentErrorCode
}

/** Actions that auto-execute without user confirmation */
export const AUTO_EXECUTE_ACTIONS = new Set([
  'add_chain',
  'add_coin',
  'remove_coin',
  'remove_chain',
  'address_book_add',
  'address_book_remove',
  'get_address_book',
  'get_balances',
  'get_portfolio',
  'search_token',
  'list_vaults',
  'build_swap_tx',
  'build_send_tx',
  'build_custom_tx',
  'build_tx',
  'sign_tx',
  'sign_typed_data',
  'read_evm_contract',
  'scan_tx',
  'thorchain_pool_info',
  'thorchain_add_liquidity',
  'thorchain_remove_liquidity',
])

/** Actions that require vault password */
export const PASSWORD_REQUIRED_ACTIONS = new Set(['sign_tx', 'sign_typed_data', 'build_custom_tx'])

// ============================================================================
// Pipe Interface (--via-agent mode) Event Types
// ============================================================================

export type PipeOutputEvent =
  | { type: 'ready'; vault: string; addresses: Record<string, string> }
  | { type: 'session'; id: string }
  | { type: 'history'; messages: Array<{ role: string; content: string; created_at: string }> }
  | { type: 'auth'; status: 'authenticated' | 'failed'; error?: string }
  | { type: 'conversation'; id: string }
  | { type: 'text_delta'; delta: string }
  | {
      type: 'tool_call'
      id: string
      action: string
      params?: Record<string, unknown>
      status: 'running' | 'done' | 'error'
    }
  | {
      type: 'tool_result'
      id: string
      action: string
      success: boolean
      data?: Record<string, unknown>
      error?: string
      code?: AgentErrorCode
    }
  | {
      type: 'tx_status'
      tx_hash: string
      chain: string
      status: 'pending' | 'confirmed' | 'failed'
      explorer_url?: string
    }
  | { type: 'assistant'; content: string }
  | { type: 'suggestions'; suggestions: Suggestion[] }
  | { type: 'error'; message: string; code: AgentErrorCode }
  | { type: 'done' }

export type PipeInputCommand =
  | { type: 'message'; content: string }
  | { type: 'confirm'; confirmed: boolean }
  | { type: 'password'; password: string }

// ============================================================================
// UI Interface (shared between TUI and Pipe)
// ============================================================================

export type UICallbacks = {
  onTextDelta: (delta: string) => void
  onToolCall: (id: string, action: string, params?: Record<string, unknown>) => void
  onToolResult: (
    id: string,
    action: string,
    success: boolean,
    data?: Record<string, unknown>,
    error?: string,
    code?: AgentErrorCode
  ) => void
  onAssistantMessage: (content: string) => void
  onSuggestions: (suggestions: Suggestion[]) => void
  onTxStatus: (txHash: string, chain: string, status: string, explorerUrl?: string) => void
  onError: (message: string, code: AgentErrorCode) => void
  onDone: () => void
  onNotification?: (title: string, body: string) => void
  requestPassword: () => Promise<string>
  requestConfirmation: (message: string) => Promise<boolean>
}
