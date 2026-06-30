/**
 * Stable error codes for CLI agent modes (`agent ask --json`, `--via-agent` pipe).
 * Distinct from {@link VaultErrorCode}; map SDK errors into these orchestrator-facing codes.
 */
import { VaultError, VaultErrorCode, VaultImportError, VaultImportErrorCode } from '@vultisig/sdk'

export enum AgentErrorCode {
  BACKEND_UNREACHABLE = 'BACKEND_UNREACHABLE',
  AUTH_FAILED = 'AUTH_FAILED',
  VAULT_LOCKED = 'VAULT_LOCKED',
  PASSWORD_REQUIRED = 'PASSWORD_REQUIRED',
  CONFIRMATION_REQUIRED = 'CONFIRMATION_REQUIRED',
  ACTION_NOT_IMPLEMENTED = 'ACTION_NOT_IMPLEMENTED',
  // A client-side tool the backend asked this client to execute is not in the
  // CLI's dispatch registry. Distinct from ACTION_NOT_IMPLEMENTED (an SDK
  // operation the CLI hasn't wired up): TOOL_UNSUPPORTED says "this *client*
  // can't run this tool at all", so the LLM should pick an alternative rather
  // than retry the same unsupported tool.
  TOOL_UNSUPPORTED = 'TOOL_UNSUPPORTED',
  INVALID_INPUT = 'INVALID_INPUT',
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  SIGNING_FAILED = 'SIGNING_FAILED',
  SESSION_NOT_INITIALIZED = 'SESSION_NOT_INITIALIZED',
  LOOP_DEPTH_EXCEEDED = 'LOOP_DEPTH_EXCEEDED',
  // Non-fatal: a resumed --session-id could not be fetched (stale/typo'd id,
  // persistent backend error, or an auth failure that survived the single
  // retry) so the session fell back to a NEW conversation. Carries the new
  // conversation id in the message so a headless caller can persist it instead
  // of silently losing prior context.
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

const AGENT_ERROR_CODE_VALUES = new Set<string>(Object.values(AgentErrorCode))

export function isAgentErrorCode(value: string): value is AgentErrorCode {
  return AGENT_ERROR_CODE_VALUES.has(value)
}

/**
 * Terminal error codes: a fatal condition that ends the turn itself, as opposed
 * to a non-terminal SSE/stream `error` frame (which `sendMessageStream` can emit
 * while continuing to parse — see {@link AskInterface.getCallbacks}). The depth
 * cap is the canonical terminal case: it aborts the message loop mid-flight.
 *
 * When `ask` latches the first error for its envelope, a terminal code is allowed
 * to overwrite a previously-recorded *non-terminal* one so the envelope names the
 * failure that actually ended the turn rather than an earlier transient frame.
 */
const TERMINAL_AGENT_ERROR_CODES = new Set<AgentErrorCode>([AgentErrorCode.LOOP_DEPTH_EXCEEDED])

export function isTerminalAgentErrorCode(code: AgentErrorCode): boolean {
  return TERMINAL_AGENT_ERROR_CODES.has(code)
}

export type NormalizedAgentError = {
  code: AgentErrorCode
  message: string
}

function mapVaultError(err: VaultError): AgentErrorCode {
  if (err.code === VaultErrorCode.InvalidConfig && /failed to unlock vault/i.test(err.message)) {
    return AgentErrorCode.AUTH_FAILED
  }

  switch (err.code) {
    case VaultErrorCode.Timeout:
      return AgentErrorCode.TIMEOUT
    case VaultErrorCode.NetworkError:
    case VaultErrorCode.BalanceFetchFailed:
      return AgentErrorCode.NETWORK_ERROR
    case VaultErrorCode.SigningFailed:
      return AgentErrorCode.SIGNING_FAILED
    case VaultErrorCode.BroadcastFailed:
    case VaultErrorCode.GasEstimationFailed:
      return AgentErrorCode.TRANSACTION_FAILED
    case VaultErrorCode.NotImplemented:
      return AgentErrorCode.ACTION_NOT_IMPLEMENTED
    case VaultErrorCode.InvalidAmount:
    case VaultErrorCode.UnsupportedChain:
    case VaultErrorCode.UnsupportedToken:
    case VaultErrorCode.ChainNotSupported:
    case VaultErrorCode.InvalidVault:
    case VaultErrorCode.InvalidPublicKey:
    case VaultErrorCode.InvalidChainCode:
    case VaultErrorCode.AddressDerivationFailed:
      return AgentErrorCode.INVALID_INPUT
    case VaultErrorCode.InvalidConfig:
      return AgentErrorCode.INVALID_INPUT
    default:
      return AgentErrorCode.UNKNOWN_ERROR
  }
}

function mapVaultImportError(err: VaultImportError): AgentErrorCode {
  switch (err.code) {
    case VaultImportErrorCode.PASSWORD_REQUIRED:
      return AgentErrorCode.PASSWORD_REQUIRED
    case VaultImportErrorCode.INVALID_PASSWORD:
      return AgentErrorCode.AUTH_FAILED
    default:
      return AgentErrorCode.INVALID_INPUT
  }
}

function networkishMessage(msg: string): boolean {
  return (
    /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network|fetch failed|socket/i.test(msg) ||
    /getaddrinfo|certificate|TLS|SSL/i.test(msg)
  )
}

/**
 * Infer a stable code from a free-form message (SSE errors, thrown Error strings, etc.).
 */
export function inferAgentErrorCodeFromMessage(message: string): AgentErrorCode {
  const m = message.trim()
  if (!m) return AgentErrorCode.UNKNOWN_ERROR

  if (/agent backend unreachable/i.test(m)) return AgentErrorCode.BACKEND_UNREACHABLE
  if (/authentication failed|^auth failed/i.test(m)) return AgentErrorCode.AUTH_FAILED
  if (m === 'PASSWORD_REQUIRED') return AgentErrorCode.PASSWORD_REQUIRED
  if (/^CONFIRMATION_REQUIRED:/i.test(m)) return AgentErrorCode.CONFIRMATION_REQUIRED
  if (/password required|password not provided|use --password/i.test(m)) return AgentErrorCode.PASSWORD_REQUIRED
  if (/session not initialized/i.test(m)) return AgentErrorCode.SESSION_NOT_INITIALIZED
  if (
    /not implemented locally|is not yet implemented|is not implemented locally|action type .*not implemented/i.test(m)
  ) {
    return AgentErrorCode.ACTION_NOT_IMPLEMENTED
  }
  if (/\(401\)|\(403\)|\b401\b|\b403\b|unauthorized|forbidden/i.test(m)) return AgentErrorCode.AUTH_FAILED
  if (/failed to unlock vault/i.test(m)) return AgentErrorCode.AUTH_FAILED
  if (/vault.*locked|must unlock|unlock.*vault/i.test(m)) return AgentErrorCode.VAULT_LOCKED
  if (/timed out|timeout/i.test(m)) return AgentErrorCode.TIMEOUT
  if (networkishMessage(m)) return AgentErrorCode.NETWORK_ERROR

  if (
    /unknown chain|unknown from_chain|unknown to_chain/i.test(m) ||
    /\bis required\b|\bmissing\b|\brequires\b/i.test(m) ||
    /no pending transaction|invalid or empty tx|could not stage calldata|server transaction missing/i.test(m) ||
    /build_custom_tx requires|incomplete for a contract call|invalid der:/i.test(m)
  ) {
    return AgentErrorCode.INVALID_INPUT
  }

  return AgentErrorCode.UNKNOWN_ERROR
}

function nodeErrCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string') {
    return (err as { code: string }).code
  }
  return undefined
}

/**
 * Normalize any thrown value into a machine-readable code and human message.
 */
export function normalizeAgentError(err: unknown): NormalizedAgentError {
  if (err instanceof VaultError) {
    return { code: mapVaultError(err), message: err.message }
  }
  if (err instanceof VaultImportError) {
    return { code: mapVaultImportError(err), message: err.message }
  }

  const name = err instanceof Error ? err.name : ''
  if (name === 'AbortError') {
    const message = err instanceof Error ? err.message : 'Aborted'
    const code = /timed out|timeout/i.test(message) ? AgentErrorCode.TIMEOUT : AgentErrorCode.UNKNOWN_ERROR
    return { code, message }
  }

  const message = err instanceof Error ? err.message : String(err)
  const nc = nodeErrCode(err)
  if (nc === 'ECONNREFUSED' || nc === 'ENOTFOUND' || nc === 'ETIMEDOUT') {
    return { code: AgentErrorCode.NETWORK_ERROR, message }
  }

  return { code: inferAgentErrorCodeFromMessage(message), message }
}
