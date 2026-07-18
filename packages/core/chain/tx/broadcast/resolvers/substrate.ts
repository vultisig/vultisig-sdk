export type SubstrateRpcError = {
  code: number
  message?: string
  data?: string
}

// These pool errors mean another MPC peer has already submitted the same
// deterministic extrinsic. Treat them as idempotent success so the slower peer
// does not show a signing failure for a transaction that is already in flight.
const idempotentBroadcastErrorPatterns: readonly RegExp[] = [/already imported/i, /already known/i]

// `TemporarilyBanned` is deliberately not a fast success. Substrate bans
// hashes after known block imports, but it can also ban transactions removed
// as invalid or dropped. Only hash verification can disambiguate those cases.

export const isIdempotentSubstrateBroadcastError = ({ message, data }: SubstrateRpcError): boolean =>
  idempotentBroadcastErrorPatterns.some(pattern => pattern.test(`${message ?? ''} ${data ?? ''}`))

// Substrate often carries the actionable InvalidTransaction reason in `data`
// while `message` contains only the generic "Invalid Transaction" label.
export const formatSubstrateRpcError = ({ code, message, data }: SubstrateRpcError): string => {
  const head = message ?? `code ${code}`
  return data ? `${head}: ${data}` : head
}
