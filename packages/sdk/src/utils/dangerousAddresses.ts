/**
 * Canonical dangerous/burn-address list, shared across every SDK build-tx
 * primitive that encodes value-moving calldata.
 *
 * Port of mcp-ts `src/lib/dangerous-addresses.ts` (itself the parity source for
 * the Go MCP guard). The CCTP bridge previously inlined a partial EVM burn-list
 * that DROPPED the third canonical EVM burn address
 * (`0xdead000000000000000042069420694206942069`, the post-#415 `EVM_DANGEROUS`
 * variant). A CCTP burn whose `mintRecipient` is that address mints USDC to a
 * permanently unspendable account on the destination chain. Centralizing the
 * list here means it can't drift per call-site again.
 *
 * Design notes (mirrored from the mcp-ts source, see PR #31 review):
 * - EVM addresses are matched by SHAPE (`0x` + 40 hex) regardless of the chain
 *   name the caller passed. Chains rotate in and out of routing tables; the
 *   burn-address set does not. A 40-hex EVM address on a chain we don't yet
 *   recognise is still treated as EVM for guard purposes, so a newly-added EVM
 *   chain can't silently escape the guard.
 * - Comparison is case-insensitive for EVM (normalize to lowercase) so a
 *   checksummed `0x...dEaD` is rejected the same as `0x...dead`.
 * - Non-EVM burn lists are keyed by the destination chain. A Solana program id
 *   should not be treated as a burn address for an unrelated chain.
 * - Self-send (`from == to`) is NOT guarded here: self-sends are a legitimate
 *   smoke-test pattern users run before the real transfer.
 */

/** EVM burn / dead addresses keyed to a human-readable reason. Keys are lowercase. */
export const EVM_DANGEROUS_ADDRESSES: Record<string, string> = {
  '0x0000000000000000000000000000000000000000':
    'zero address (ETH burn address): funds sent here are permanently destroyed',
  '0x000000000000000000000000000000000000dead': 'dead address (commonly used burn address): funds are unrecoverable',
  '0xdead000000000000000042069420694206942069': 'dead address variant: funds are unrecoverable',
}

/** Solana burn / program destinations that cannot be user-controlled. Keys are case-sensitive. */
export const SOLANA_DANGEROUS_ADDRESSES: Record<string, string> = {
  '11111111111111111111111111111111': 'Solana System Program: no private key controls this address',
  '1nc1nerator11111111111111111111111111111111':
    'Solana Incinerator burn address: funds sent here are permanently destroyed',
}

/** Shape of a 20-byte EVM address (`0x` + 40 hex). */
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

/**
 * Return the dangerous-address reason string if `address` is a known EVM burn
 * address, otherwise `undefined`. Shape-based: any `0x`+40-hex string is vetted
 * against the EVM burn-list regardless of the chain it's destined for.
 */
export const getEvmDangerousReason = (address: string): string | undefined => {
  if (!EVM_ADDRESS_RE.test(address)) return undefined
  return EVM_DANGEROUS_ADDRESSES[address.toLowerCase()]
}

/** True iff `address` is a known EVM burn / dead address. */
export const isEvmBurnAddress = (address: string): boolean => getEvmDangerousReason(address) !== undefined

/** Return the chain-specific dangerous-address reason, if one applies. */
export const getChainDangerousReason = (chain: string, address: string): string | undefined => {
  if (chain.trim().toLowerCase() === 'solana') {
    return SOLANA_DANGEROUS_ADDRESSES[address.trim()]
  }

  return undefined
}

/**
 * Throws a descriptive error if `address` is a known EVM burn / dead address.
 * Call this in every primitive that encodes a destination/recipient into
 * value-moving calldata, BEFORE building the calldata.
 */
export const assertSafeEvmDestination = (address: string): void => {
  const reason = getEvmDangerousReason(address)
  if (reason) {
    throw new Error(`Refusing to build transaction: destination ${address} is a ${reason}.`)
  }
}

/**
 * Chain-aware overload of the burn-address guard used by swap/bridge tools.
 * EVM detection remains shape-based; non-EVM lists are keyed by the destination
 * chain so family-specific sentinel addresses do not block unrelated chains.
 */
export function assertSafeDestination(chain: string, destination: string): void {
  assertSafeEvmDestination(destination)
  const reason = getChainDangerousReason(chain, destination)
  if (reason) {
    throw new Error(`Refusing to build transaction: destination ${destination} is a ${reason}.`)
  }
}
