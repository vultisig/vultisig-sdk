/**
 * Public namespace objects for pure address-format validation.
 *
 * Exposes:
 *   - `validate.chainPrefix(address, chain)` — HRP/format mismatch check
 *   - `address.classify(address)`            — chain-family of an address format
 *   - `address.isValidFor(address, chain)`   — is the format valid for a chain
 *   - `address.supportedChains()`            — chains with a FORMAT rule
 *
 * These collapse the duplicated FORMAT rules that previously lived in the Go
 * agent backend (validator/chain_prefix_extractor.go + validator/address/*.go)
 * and the abt src/mastra/chainPrefix.ts mirror into one canonical SDK source.
 *
 * PURE CRYPTO / FORMAT ONLY — no intent-match, no grounding, no network, no
 * signing. See addressFormat.ts and chainPrefix.ts for the rule sources.
 */

import {
  type AddressFamily,
  type AddressRole,
  classifyAddress,
  isAddressValidForChain,
  supportedChainTags,
} from './addressFormat'
import { type ChainPrefixResult, checkChainPrefix } from './chainPrefix'

/**
 * `validate` namespace — format-validation checks that return structured
 * results suitable for fund-safety gating before a tx is built.
 */
export const validate = {
  /**
   * Validate that an address FORMAT matches a claimed chain (HRP/prefix check).
   * Fails open (`valid: true`, `reason: 'unknown-chain'`) for chains with no
   * FORMAT rule, mirroring the backend extractor's skip behavior.
   *
   * Pass `role: 'validator'` for cosmos staking validator-operator fields
   * (`validator_address`, …) so the address is checked against the valoper HRP
   * (`<chain>valoper1…`) instead of the account HRP — mirrors the Go validator's
   * field-aware routing (cosmosValopers). Defaults to `'account'`.
   */
  chainPrefix: (address: string, chain: string, role: AddressRole = 'account'): ChainPrefixResult =>
    checkChainPrefix(address, chain, role),
} as const

/**
 * `address` namespace — coarse classification + per-chain format validity.
 */
export const address = {
  /** Return the chain family an address FORMAT belongs to, or `unknown`. */
  classify: (addr: string): AddressFamily => classifyAddress(addr),
  /**
   * Return true when `addr` is a valid FORMAT for `chain`, false on mismatch,
   * `undefined` when the chain has no FORMAT rule (caller cannot decide).
   *
   * Pass `role: 'validator'` for cosmos staking validator-operator addresses so
   * the check uses the valoper HRP (`<chain>valoper1…`). Defaults to `'account'`.
   */
  isValidFor: (addr: string, chain: string, role: AddressRole = 'account'): boolean | undefined =>
    isAddressValidForChain(addr, chain, role),
  /** Canonical chain tags that have a FORMAT rule. */
  supportedChains: (): string[] => supportedChainTags(),
} as const

export type { AddressFamily, AddressRole, ChainPrefixResult }
