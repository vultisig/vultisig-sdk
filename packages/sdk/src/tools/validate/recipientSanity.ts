/**
 * recipientSanity — pure, deterministic recipient-address sanity checks.
 *
 * This is the PURE-CRYPTO / pure-format slice of the agent-backend recipient
 * validators (null_recipient.go, self_send_warning.go, malformed_evm_recipient.go).
 * It performs ONLY deterministic format / equality checks on the destination
 * address itself:
 *
 *   - null:           the recipient is a null / burn address that no private
 *                     key controls (EVM zero address, EVM 0x...dEaD, Solana
 *                     System Program, Solana Incinerator).
 *   - selfSend:       from === recipient (case-insensitive equality).
 *   - malformedEvm:   the recipient looks like an EVM attempt (0x + hex only)
 *                     but is NOT a valid 42-char (0x + 40 hex) address.
 *
 * It does NOT perform any agent-judgement: no intent-vs-user-message matching,
 * no fabricated-vs-grounded reasoning, no prompt-injection detection, and it
 * never signs or broadcasts. Those layers stay in the agent backend.
 *
 * All checks are conservative: only values that are NEVER a valid
 * fund-receiving address on any mainnet are flagged as `null`, and only
 * unambiguous EVM-shaped attempts are flagged as `malformedEvm`.
 */

import {
  isEvmBurnAddress,
  SOLANA_DANGEROUS_ADDRESSES,
  UTXO_DANGEROUS_ADDRESSES,
  XRP_DANGEROUS_ADDRESSES,
} from '../../utils/dangerousAddresses'

/** A single deterministic finding about a recipient address. */
export type RecipientSanityFlag = 'null' | 'selfSend' | 'malformedEvm'

/** Inputs to {@link recipientSanity}. All fields are plain strings. */
export type RecipientSanityInput = {
  /** The destination / recipient address to sanity-check. */
  recipient: string
  /**
   * The sender / from address, when known. Only used for the self-send
   * equality check. Omit (or pass empty) to skip the self-send check.
   */
  from?: string
}

/** Result of {@link recipientSanity}. */
export type RecipientSanityResult = {
  /** Echo of the trimmed recipient that was checked. */
  recipient: string
  /** True when at least one deterministic flag fired. */
  flagged: boolean
  /** The set of flags that fired, in deterministic order. */
  flags: RecipientSanityFlag[]
  /** True when the recipient is a null / burn address. */
  isNull: boolean
  /** True when from === recipient (case-insensitive). */
  isSelfSend: boolean
  /** True when the recipient is an EVM-shaped attempt that is not valid. */
  isMalformedEvm: boolean
}

/** Matches a 0x-prefixed all-hex string of any length. */
const EVM_PREFIX_RE = /^0x[0-9a-fA-F]+$/

/**
 * Returns true when `addr` is an all-zero / burn address that no real user
 * wallet controls.
 *
 * Routed through the canonical shared burn-address table
 * (`@vultisig/core-chain/security/dangerousAddresses`) so it can never drift
 * from the other guards again. This is STRICTLY additive vs the old inline copy
 * (EVM zero + `0x...dEaD` + Solana System Program + Incinerator): the shared
 * table also covers the third EVM burn variant (`0xdead...42069`), the SPL Token
 * Program + Wrapped SOL mint, the Bitcoin null/eater burns, and the XRP Ledger
 * black-hole accounts.
 *
 *   - EVM: matched by SHAPE (0x + 40 hex, case-insensitive) against the EVM burn
 *     set — covers all three canonical EVM burn addresses.
 *   - Non-EVM: this check has no chain context, so it vets against the UNION of
 *     the Solana / UTXO / XRP family maps. Those keys are unambiguous distinct
 *     sentinel strings, so a family-specific burn is caught wherever it appears.
 *
 * Conservative: partial-zero addresses (e.g. 0x0000...0001) are NOT flagged
 * because 0x...01 is a valid if unusual address.
 */
export function isNullAddress(addr: string): boolean {
  const trimmed = addr.trim()
  if (trimmed === '') return false

  if (isEvmBurnAddress(trimmed)) return true
  if (trimmed in SOLANA_DANGEROUS_ADDRESSES) return true
  if (trimmed in UTXO_DANGEROUS_ADDRESSES) return true
  if (trimmed in XRP_DANGEROUS_ADDRESSES) return true

  return false
}

/**
 * Returns true when `addr` looks like an EVM address attempt (0x + hex chars
 * only) but is NOT a valid 42-char EVM address (0x + 40 hex digits).
 *
 * Ported from malformed_evm_recipient.go:isMalformedEVMAddress. Empty strings
 * and non-0x strings are NOT flagged — those are a different address family
 * handled elsewhere.
 */
export function isMalformedEvmAddress(addr: string): boolean {
  const trimmed = addr.trim()
  if (trimmed === '') return false
  if (!EVM_PREFIX_RE.test(trimmed)) return false
  // A valid EVM address is exactly 42 chars (0x + 40 hex digits).
  return trimmed.length !== 42
}

/**
 * Returns true when `from` and `recipient` are the same address
 * (case-insensitive equality, after trimming). Both must be non-empty.
 *
 * Ported from self_send_warning.go:detectSelfSendTurn (the args-comparison
 * branch only — the agent-judgement "did the model emit the warning?" layer
 * stays in the backend).
 */
export function isSelfSend(from: string, recipient: string): boolean {
  const f = from.trim()
  const r = recipient.trim()
  if (f === '' || r === '') return false
  return f.toLowerCase() === r.toLowerCase()
}

/**
 * Pure, deterministic recipient sanity check.
 *
 * Runs the null / self-send / malformed-EVM format checks against a recipient
 * address and (optionally) a from address, returning a structured result.
 * Never throws on malformed input — unknown shapes simply produce no flags.
 *
 * @example
 * ```ts
 * recipientSanity({ recipient: '0x0000000000000000000000000000000000000000' })
 * // => { flagged: true, flags: ['null'], isNull: true, ... }
 *
 * recipientSanity({ from: '0xAbC...', recipient: '0xabc...' })
 * // => { flagged: true, flags: ['selfSend'], isSelfSend: true, ... }
 *
 * recipientSanity({ recipient: '0xdeadbeef' })
 * // => { flagged: true, flags: ['malformedEvm'], isMalformedEvm: true, ... }
 * ```
 */
export function recipientSanity(input: RecipientSanityInput): RecipientSanityResult {
  // Normalize defensively: callers from untyped JS runtimes may pass null/number.
  const recipient = String(input.recipient ?? '').trim()
  const from = String(input.from ?? '').trim()

  const nullFlag = isNullAddress(recipient)
  const selfSendFlag = isSelfSend(from, recipient)
  const malformedEvmFlag = isMalformedEvmAddress(recipient)

  // Deterministic flag order: null, selfSend, malformedEvm.
  const flags: RecipientSanityFlag[] = []
  if (nullFlag) flags.push('null')
  if (selfSendFlag) flags.push('selfSend')
  if (malformedEvmFlag) flags.push('malformedEvm')

  return {
    recipient,
    flagged: flags.length > 0,
    flags,
    isNull: nullFlag,
    isSelfSend: selfSendFlag,
    isMalformedEvm: malformedEvmFlag,
  }
}
