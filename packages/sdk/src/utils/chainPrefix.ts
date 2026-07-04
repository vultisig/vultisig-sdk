/**
 * Pure chain-prefix / HRP mismatch validation.
 *
 * Canonical port of the FORMAT-mismatch detection in
 * agent-backend chain_prefix_extractor.go (checkSingleChain) and the
 * abt src/mastra/chainPrefix.ts mirror.
 *
 * Fund-safety motivation (verbatim from the Go source): a `cosmos1...`
 * address on a Terra v2 build call would pass a grounding check (the user
 * typed it) yet would lose funds — Terra only routes `terra1...` HRP
 * addresses. This primitive catches the FORMAT/HRP mismatch between a chain
 * tag and an address, BEFORE any tx is built or signed.
 *
 * Scope: PURE FORMAT validation. It does NOT do intent-match, grounding, or
 * fabrication detection — those stay in the agent backend's judgement layer.
 * No network, no signing.
 */

import { type AddressRole, canonicalChainTag, classifyAddress, isAddressValidForChain } from './addressFormat'

/** Result of a chain-prefix check. */
export type ChainPrefixResult = {
  /** Whether the address FORMAT is valid for the claimed chain. */
  valid: boolean
  /** The address that was checked (trimmed). */
  address: string
  /** The chain that was claimed (as passed in). */
  chain: string
  /** The canonical chain tag the chain resolved to. */
  canonicalChain: string
  /**
   * The chain family the address FORMAT actually belongs to, or `unknown`.
   * Useful for explaining a mismatch ("you claimed ethereum but this is a
   * cosmos address").
   */
  detectedFamily: ReturnType<typeof classifyAddress>
  /**
   * Why the check returned the result it did:
   *  - `match`       — address format is valid for the chain
   *  - `mismatch`    — address format does NOT match the chain (fund-safety hit)
   *  - `unknown-chain` — no FORMAT rule for the chain; cannot decide (valid=true,
   *    fail-open, mirrors the backend's chainHRPMap `!ok` skip)
   *  - `empty`       — address or chain was empty
   */
  reason: 'match' | 'mismatch' | 'unknown-chain' | 'empty'
}

/**
 * checkChainPrefix validates that `address` is a plausible FORMAT for `chain`.
 *
 * Fail-open on unknown chains (mirrors the backend extractor's skip when a
 * chain is absent from the HRP map) so this never over-blocks a legitimate
 * address on a chain the SDK doesn't yet have a format rule for.
 *
 * When `role === 'validator'` the address is checked against the chain's
 * valoper HRP (cosmos staking validator fields), mirroring the Go validator's
 * field-aware routing. Defaults to `'account'`.
 *
 * @example
 * checkChainPrefix('osmo1...', 'ethereum').valid // false (HRP mismatch)
 * checkChainPrefix('0xabc...40hex', 'ethereum').valid // true
 * checkChainPrefix('cosmos1...', 'cosmos', 'validator').valid // false (needs cosmosvaloper1)
 * checkChainPrefix('cosmosvaloper1...', 'cosmos', 'validator').valid // true
 */
export function checkChainPrefix(address: string, chain: string, role: AddressRole = 'account'): ChainPrefixResult {
  const addr = (address ?? '').trim()
  const canonicalChain = canonicalChainTag(chain ?? '')
  const detectedFamily = classifyAddress(addr)

  if (addr === '' || (chain ?? '').trim() === '') {
    return {
      valid: false,
      address: addr,
      chain,
      canonicalChain,
      detectedFamily,
      reason: 'empty',
    }
  }

  const formatValid = isAddressValidForChain(addr, chain, role)
  if (formatValid === undefined) {
    // No FORMAT rule for this chain — cannot decide, fail open.
    return {
      valid: true,
      address: addr,
      chain,
      canonicalChain,
      detectedFamily,
      reason: 'unknown-chain',
    }
  }

  return {
    valid: formatValid,
    address: addr,
    chain,
    canonicalChain,
    detectedFamily,
    reason: formatValid ? 'match' : 'mismatch',
  }
}
