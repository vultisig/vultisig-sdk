/**
 * Canonical known-dangerous / burn-address guard for SDK tools.
 *
 * Ported from the mcp-ts `lib/dangerous-addresses.ts` source contract so the
 * burn-list cannot drift per-tool. Every tool that forwards or builds a
 * destination/recipient address (swap quotes, bridges, build_* calldata) must
 * call `assertSafeDestination(chain, address)` before using it — the function
 * throws a user-facing error the LLM can relay as a refusal rather than
 * silently quoting/building a burn tx.
 *
 * Currently covers the EVM family (the only address shape the SDK's EVM swap /
 * bridge primitives forward today). The structure mirrors mcp-ts so the other
 * families (Solana / UTXO / XRP) can be ported here when their build_* tools
 * land, instead of re-inlining a partial list at each call site.
 *
 * Design notes (mirrors mcp-ts):
 * - EVM addresses are matched by shape (`0x` + 40 hex) regardless of the chain
 *   name the caller passed. Chains rotate in and out of routing tables; the
 *   burn-address set does not. A 40-hex address on a chain we don't recognise
 *   is still treated as EVM for guard purposes.
 * - Self-send (`from == to`) is intentionally NOT guarded here.
 */

const EVM_DANGEROUS: Record<string, string> = {
  '0x0000000000000000000000000000000000000000':
    'zero address (ETH burn address) — funds sent here are permanently destroyed',
  '0x000000000000000000000000000000000000dead': 'dead address — commonly used burn address, funds are unrecoverable',
  '0xdead000000000000000042069420694206942069': 'dead address variant — funds are unrecoverable',
}

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

/**
 * Return the dangerous-address table that applies to `destination`. EVM is
 * detected by shape so new EVM chains (and any `chainId` override path) can't
 * silently escape the guard.
 */
function getDangerousAddresses(destination: string): Record<string, string> {
  if (EVM_ADDRESS_RE.test(destination)) return EVM_DANGEROUS
  return {}
}

/**
 * Throws a descriptive error if `destination` is a known dangerous address.
 * Call this early in every quote/build tool handler, BEFORE any expensive work
 * (price lookups, RPC calls, balance fetches) and BEFORE forwarding the
 * recipient to an upstream API.
 *
 * `chain` is accepted to match the mcp-ts source contract and for future
 * non-EVM family routing; EVM detection is shape-based and does not depend on
 * it.
 */
export function assertSafeDestination(_chain: string, destination: string): void {
  const dangerous = getDangerousAddresses(destination)
  // Normalize EVM addresses to lowercase for comparison.
  const normalized = destination.startsWith('0x') ? destination.toLowerCase() : destination
  const reason = dangerous[normalized]
  if (reason) {
    throw new Error(`Refusing to build transaction: destination ${destination} is a ${reason}.`)
  }
}
