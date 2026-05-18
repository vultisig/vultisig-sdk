/**
 * Shared verifier contract. Each chain verifier resolves a broadcast
 * identifier (EVM tx hash, Solana signature, …) against an INDEPENDENT
 * public RPC — intentionally a different endpoint than the one sdk-cli
 * broadcasts through, so a proxy that silently swallows a malformed tx
 * and reports success on its own downstream can't also fake the
 * verification.
 */

export type OnChainResult = {
  /** True only if the chain's canonical RPC has a record of the tx. */
  exists: boolean
  /** Normalized lowercase sender (chain-native format). */
  fromAddr?: string
  /** Normalized lowercase recipient. */
  toAddr?: string
  /** Native-unit value as a decimal string (wei for ETH, lamports for SOL). */
  value?: string
  /** Block / slot the tx landed in. Absence ⇒ not yet mined / not landed. */
  blockNumber?: number
  /** Chain id where applicable (EVM). */
  chainId?: number
  /** Raw RPC payload, kept for the forensic artifact. */
  raw?: unknown
}

export type VerifyOptions = {
  /** Max seconds to poll before giving up (default 60). */
  timeoutSec?: number
  /** Poll interval in ms (default 3000). */
  intervalMs?: number
}
