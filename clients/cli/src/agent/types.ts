/**
 * Agent Chat - Type Definitions
 *
 * Types for the agent chat system including SSE events,
 * backend API types, action execution, and UI interfaces.
 */
import type { Vultisig } from '@vultisig/sdk'

import type { AgentErrorCode } from './agentErrors'
import type { BalanceSummaryCard } from './cards'

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
  /** Billing profile api_id slug — sent as X-Vultisig-Abe-Profile header.
   *  Empty falls back to the backend's default profile. */
  profile?: string
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
  // agent-backend /auth/token also returns `access_token` (a duplicate of
  // `token` under the shape vultiagent-poc's auth layer writes to) and a
  // `refresh_token`. Modeled as optional so the CLI can capture + persist the
  // refresh token for a future POST /auth/refresh exchange; see auth.ts.
  access_token?: string
  refresh_token?: string
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
  // AI-SDK UIMessagePart list, present on messages fetched from
  // /messages/since (the disconnect-recovery endpoint). Text parts carry the
  // assistant answer; `data-tx_ready` parts carry a persisted signable card so
  // a turn that dropped its SSE stream mid-flight can still recover both.
  parts?: ConversationMessagePart[]
}

// Minimal projection of the backend's UIMessagePart (internal/types/parts.go).
// Only the fields the CLI recovery path reads are typed; `type` is the
// discriminator ("text", "data-tx_ready", "tool-<name>", …).
export type ConversationMessagePart = {
  type: string
  text?: string
  id?: string
  data?: unknown
}

// Response body of GET /agent/conversations/:id/messages/since — the
// reconnect-and-replay contract (agent-backend messages_since.go). `cursor` is
// an OPAQUE composite (created_at, id) token to round-trip on the next poll.
export type MessagesSinceResponse = {
  messages: ConversationMessage[]
  cursor: string
  toolResults?: Record<string, unknown>
}

// ============================================================================
// Message Context (sent with each message)
// ============================================================================

export type MessageContext = {
  vault_address?: string
  vault_name?: string
  mldsa_public_key?: string
  // Root vault keys + chain code. agent-backend reads these from req.Context
  // (extractVaultInfoFromContext) to build req.VaultInfo, which is then
  // injected into MCP tool calls flagged with _meta.inject_vault_args
  // (e.g. show_receive_request). Without them, every such tool errors with
  // "Vault not configured" at the MCP layer. Mirrors vultiagent-app's
  // agentContext.ts which has always sent these fields.
  ecdsa_public_key?: string
  eddsa_public_key?: string
  hex_chain_code?: string
  balances?: BalanceInfo[]
  addresses?: Record<string, string>
  coins?: CoinInfo[]
  address_book?: AddressBookEntry[]
  // Per-chain hardened-derived public keys for KeyImport/seedphrase vaults
  // (Solana, Sui, Polkadot, Terra, …) whose addresses can't be derived from
  // the root ECDSA key alone. Keys are Chain enum names, values hex pubkeys.
  // agent-backend reads this from req.Context.ChainPublicKeys, persists it on
  // the conversation, and forwards it to MCP tools so address derivation uses
  // the hardened path. Omitted entirely for standard MPC vaults.
  chain_public_keys?: Record<string, string>
  // Client-side tool results from the previous turn. Post-PR-#119 return
  // channel (replaces top-level action_result).
  recent_actions?: RecentAction[]
}

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
  /**
   * Data-part surface keys the CLI can render. When "balance_summary" is
   * present the backend emits a `data-balance_summary` SSE part and strips
   * `card_payload` from the model-visible tool result, so the model narrates
   * instead of echoing raw card JSON into message content (the legacy
   * verbatim-echo path). See backend types.go SupportedSurfaces.
   */
  supported_surfaces?: string[]
}

export type ToolDefinition = {
  name: string
  params: string
}

export type SendMessageResponse = {
  message: ConversationMessage
  title?: string
  suggestions?: Suggestion[]
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
export type SSEToolProgress = {
  tool: string
  status: 'running' | 'done'
  label?: string
}
export type SSETitle = { title: string }
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
  | { type: 'suggestions'; data: SSESuggestions }
  | { type: 'tx_ready'; data: SSETxReady }
  | { type: 'policy_ready'; data: SSEPolicyReady }
  | { type: 'install_required'; data: SSEInstallRequired }
  | { type: 'message'; data: SSEMessage }
  | { type: 'error'; data: SSEError }
  | { type: 'done'; data: Record<string, never> }

// ============================================================================
// Pipe Interface (--via-agent mode) Event Types
// ============================================================================

/**
 * Transaction lifecycle status emitted by post-broadcast confirmation polling.
 * `pending` on broadcast → `confirmed`/`failed` once the on-chain outcome
 * resolves → `timeout` when the bounded poll budget is exhausted (the tx may
 * still confirm later). Shared so the union is preserved end-to-end (pipe
 * event, ask result, UI callback) without unchecked `as` casts.
 */
export type TxLifecycleStatus = 'broadcast' | 'pending' | 'confirmed' | 'failed' | 'timeout'

export type PipeOutputEvent =
  | { type: 'ready'; vault: string; addresses: Record<string, string> }
  | { type: 'session'; id: string }
  | {
      type: 'history'
      messages: Array<{ role: string; content: string; created_at: string }>
    }
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
      status: TxLifecycleStatus
      explorer_url?: string
    }
  | { type: 'assistant'; content: string }
  | { type: 'balance_summary'; card: BalanceSummaryCard }
  | { type: 'suggestions'; suggestions: Suggestion[] }
  // Emitted when the SSE stream dropped mid-turn and the CLI is polling
  // /messages/since to recover the answer — lets an agent consumer
  // distinguish "still working" from "failed".
  | { type: 'reconnecting' }
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
  /** Render a server-built balance_summary card (data-balance_summary SSE part,
   *  or the legacy verbatim-echo fallback parsed from message content). */
  onBalanceSummary?: (card: BalanceSummaryCard) => void
  onSuggestions: (suggestions: Suggestion[]) => void
  onTxStatus: (txHash: string, chain: string, status: TxLifecycleStatus, explorerUrl?: string) => void
  onError: (message: string, code: AgentErrorCode) => void
  onDone: () => void
  // Fired when a mid-turn SSE disconnect is detected and the session begins
  // polling /messages/since to recover the dropped answer/tx_ready.
  onReconnecting?: () => void
  onNotification?: (title: string, body: string) => void
  requestPassword: () => Promise<string>
  requestConfirmation: (message: string) => Promise<boolean>
}
