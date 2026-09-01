const LONG_HEX_PAYLOAD = /0x[0-9a-f]{128,}/giu

type ErrorWithRpcDetails = Error & {
  details?: unknown
  shortMessage?: unknown
}

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined

/**
 * Keep an RPC rejection actionable without echoing a signed transaction from
 * viem's request diagnostics into terminals or JSON error envelopes.
 */
export const formatBroadcastFailureReason = (cause: unknown): string => {
  if (!(cause instanceof Error)) {
    return String(cause).replace(LONG_HEX_PAYLOAD, '[signed transaction redacted]')
  }

  const rpcError = cause as ErrorWithRpcDetails
  const reason = nonEmptyString(rpcError.details) ?? nonEmptyString(rpcError.shortMessage) ?? cause.message

  return reason.replace(LONG_HEX_PAYLOAD, '[signed transaction redacted]').trim()
}

/** Build a diagnostic Error whose public message is safe while retaining the cause in memory. */
export const toSafeBroadcastError = (cause: unknown): Error => {
  const reason = formatBroadcastFailureReason(cause)
  if (cause instanceof Error && cause.message === reason) return cause

  return new Error(reason, { cause })
}
