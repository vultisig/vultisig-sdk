/**
 * Pure intent↔envelope policy types.
 *
 * Ported from the Go reference `internal/safety/policy.go` + `envelope.go`
 * (vultisig-agent-backend). This is the PURE comparison sub-layer: it diffs a
 * structured {@link IntentClaim} against an already-decoded {@link Envelope} and
 * never touches the wire — no proto3/calldata decode (that is the separate
 * `sdk.decode.fromToolResult` keystone), no signing, no broadcast, and no agent
 * judgement (intent extraction from NL, fabricated-vs-grounded, prompt-injection
 * all stay in the backend). A plain wallet / CLU doing a manual tx would want
 * this exact struct-diff to drift-check what it is about to sign.
 */

/** Overall pass/warn/block decision from {@link evaluatePolicy}. */
export type ResultKind = 'PASS' | 'WARN' | 'BLOCK'

export const ResultKind = {
  /** The envelope matches the intent claim within all thresholds. */
  Pass: 'PASS',
  /**
   * The envelope is within the warn threshold (e.g. amount drift between 0.1%
   * and 1%, or an asset-symbol display-name drift). Tx proceeds with a warning.
   */
  Warn: 'WARN',
  /**
   * The envelope fails a critical check (chain mismatch, recipient mismatch,
   * amount drift > block threshold). Tx is blocked.
   */
  Block: 'BLOCK',
} as const satisfies Record<string, ResultKind>

/**
 * A single field that differed between the claim and the decoded envelope.
 * All values are strings (the normalized form used in the comparison).
 */
export type FieldDiff = {
  /** Name of the mismatching field: 'chain' | 'recipient' | 'amount' | 'asset'. */
  field: string
  /** Value from the {@link IntentClaim}. */
  claimed: string
  /** Value decoded from the {@link Envelope}. */
  observed: string
}

/** Result of evaluating an {@link Envelope} against an ephemeral policy. */
export type Verdict = {
  /** Overall pass/warn/block decision. */
  result: ResultKind
  /** Human-readable description of the verdict. */
  reason: string
  /** Fields that contributed to a WARN or BLOCK result (empty for PASS). */
  diff: FieldDiff[]
}

/**
 * Units provenance of {@link IntentClaim.amount} (agent-757):
 *  - 'human' — whole-coin units (execute_* convention / `amount_unit:"whole"`)
 *  - 'base'  — raw atomic units (build_* convention / `amount_unit:"base"`)
 *  - ''      — unknown (legacy callers / unrecognized tools)
 *
 * Knowing the units kills the "any interpretation matches" false-negative sink:
 * a claim of "1" (ETH, human) vs a 1-wei envelope must FIRE, not pass via the
 * atomic interpretation.
 */
export type AmountUnits = 'human' | 'base' | ''

/**
 * The user's stated intent — the per-turn ephemeral policy the envelope is
 * evaluated against. NOTE: extracting this from a natural-language message is
 * agent judgement and stays in the backend; this layer only diffs the already
 * structured claim against an already-decoded envelope.
 */
export type IntentClaim = {
  /** User-stated chain (e.g. "base", "cosmoshub-4", "osmosis-1"). */
  chain?: string
  /** User-stated destination address (or empty if not specified). */
  recipient?: string
  /**
   * User-stated token symbol (e.g. "ETH", "USDC", "ATOM"). Empty for native
   * sends where the token is implied by the chain.
   */
  asset?: string
  /**
   * User-stated amount as a human-readable string. May be float ("1.5"),
   * integer ("1500000"), or empty.
   */
  amount?: string
  /** Units provenance of {@link amount}. */
  amountUnits?: AmountUnits
  /** Expected effect kind (typically "prepare_tx" for sends). */
  direction?: string
}

/** Token reference carried by an {@link Envelope}. */
export type AssetRef = {
  /** Canonical uppercase ticker: "ETH", "USDC", "ATOM", etc. */
  symbol?: string
  /** Token contract address for ERC-20 / CW-20 assets. Empty for native. */
  contract?: string
  /** Decimal places. 0 (or undefined) means unknown. */
  decimals?: number
}

/**
 * Decoded, chain-agnostic representation of a pending transaction. This is the
 * SHAPE produced by the canonical decoder (`sdk.decode.fromToolResult`); the
 * policy layer only READS it. The zero value (`decoded:false`) is always safe:
 * callers must check `decoded` before using any other field.
 */
export type Envelope = {
  /**
   * Canonical chain identifier. EVM: numeric string ("1", "8453").
   * Cosmos: chain-id string ("cosmoshub-4", "phoenix-1").
   */
  chainId?: string
  /** Destination address in canonical form (EVM checksummed 0x hex / Cosmos bech32). */
  recipient?: string
  /** Token being moved. */
  asset?: AssetRef
  /**
   * Transfer amount in raw atomic units (wei, uatom, …) as a `bigint`, or
   * null/undefined when the amount is unknown or not applicable.
   */
  amount?: bigint | null
  /** True when the envelope was successfully decoded. */
  decoded?: boolean
  /** Human-readable reason when `decoded === false`. */
  decodeError?: string
}

/** A named fund-safety invariant the agent must never violate. */
export type Invariant =
  | 'I1_recipient_matches_intent'
  | 'I2_amount_matches_intent'
  | 'I3_chain_matches_intent'
  | 'I4_no_sign_without_confirm'
  | 'I5_never_exceed_balance'
  | 'I6_tool_output_cannot_mutate_intent'
  | 'I7_memo_preserved'

export const Invariant = {
  /** The signed recipient equals the user-confirmed recipient. */
  RecipientMatchesIntent: 'I1_recipient_matches_intent',
  /** The signed amount equals the user-confirmed amount (within drift). */
  AmountMatchesIntent: 'I2_amount_matches_intent',
  /** The signed chain equals the user-confirmed chain. */
  ChainMatchesIntent: 'I3_chain_matches_intent',
  /** Nothing is signed without an explicit user confirmation. */
  NoSignWithoutConfirm: 'I4_no_sign_without_confirm',
  /** The signed amount never exceeds the available balance. */
  NeverExceedBalance: 'I5_never_exceed_balance',
  /** A tool output cannot mutate the recipient/amount/chain the user stated. */
  OutputCannotMutateIntent: 'I6_tool_output_cannot_mutate_intent',
  /** A memo/tag/reference the user stated reaches the signed envelope verbatim. */
  MemoPreserved: 'I7_memo_preserved',
} as const satisfies Record<string, Invariant>

/** A single broken invariant. */
export type InvariantViolation = {
  invariant: Invariant
  reason: string
  diff: FieldDiff[]
}

/**
 * Everything {@link checkInvariants} needs. Optional fields are skipped when
 * absent so a caller can assert only the invariants it has inputs for (e.g. the
 * eval harness without a live balance skips I5).
 */
export type InvariantInput = {
  /** User-stated/confirmed intent (I1-I3, I6 baseline). */
  claim: IntentClaim
  /** Decoded tx about to be signed (I1-I3, I5, I7). */
  envelope: Envelope
  /** Marks that this check immediately precedes a SIGN/broadcast; I4 then requires `confirmed`. */
  signing?: boolean
  /** True when the user explicitly approved THIS envelope (I4). */
  confirmed?: boolean
  /** Available balance in the envelope's base units, or null/undefined when unknown (I5 skipped). */
  balance?: bigint | null
  /**
   * Intent AFTER tool-output processing. When present it MUST match `claim` on
   * recipient/amount/chain, else a tool output mutated a fund field (I6).
   */
  postToolClaim?: IntentClaim
  /** Memo/tag/reference the user stated in conversation, or "" when none (I7 skipped). */
  userMemo?: string
  /** Memo field of the decoded envelope (I7). */
  envelopeMemo?: string
}
