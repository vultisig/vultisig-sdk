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

/**
 * Canonical EVM "dead" burn address (0x...000dEaD). Holds no private key and
 * is a near-universal convention for intentionally destroying tokens.
 */
const EVM_DEAD_BURN_ADDRESS = '0x000000000000000000000000000000000000dead'

/**
 * Solana's documented Incinerator burn address. The runtime destroys any
 * lamports / tokens sent there; no private key controls it. Case-sensitive
 * base58.
 */
const SOLANA_INCINERATOR = '1nc1nerator11111111111111111111111111111111'

/**
 * Solana System Program address (base58 encoding of 32 zero-bytes). No
 * private key controls it. Case-sensitive base58.
 */
const SOLANA_SYSTEM_PROGRAM = '11111111111111111111111111111111'

/** Matches a 0x-prefixed all-hex string of any length. */
const EVM_PREFIX_RE = /^0x[0-9a-fA-F]+$/

/**
 * Returns true when `addr` is an all-zero / burn address that no real user
 * wallet controls.
 *
 * Coverage (ported from null_recipient.go:isNullAddress):
 *   - EVM: 0x + exactly 40 hex zero-digits (case-insensitive), AND the
 *     canonical 0x...dEaD burn address.
 *   - Solana: the System Program address (32 zero-bytes base58), AND the
 *     documented Incinerator burn address.
 *
 * Conservative: partial-zero addresses (e.g. 0x0000...0001) are NOT flagged
 * because 0x...01 is a valid if unusual address.
 */
export function isNullAddress(addr: string): boolean {
  const trimmed = addr.trim()
  if (trimmed === '') return false
  const lower = trimmed.toLowerCase()

  // EVM zero address: 0x + 40 hex zeros.
  if (lower.startsWith('0x') && lower.length === 42) {
    if (/^0+$/.test(lower.slice(2))) return true
  }
  // EVM dead / burn address (0x...000dEaD) — case-insensitive.
  if (lower === EVM_DEAD_BURN_ADDRESS) return true
  // Solana System Program (base58 of 32 zero-bytes) — case-sensitive.
  if (trimmed === SOLANA_SYSTEM_PROGRAM) return true
  // Solana Incinerator burn address — case-sensitive base58.
  if (trimmed === SOLANA_INCINERATOR) return true

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
