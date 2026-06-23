/**
 * Chain-agnostic decoded-transaction shape shared by every safety surface.
 *
 * The Envelope is the canonical "bytes oracle" output: a single, family-neutral
 * representation of a pending transaction derived purely from its on-the-wire
 * bytes (EVM RLP / Cosmos proto3). It carries NO agent judgement — no
 * intent-match, no grounding, no policy. It is the thing the isolate
 * `hostValidate`, CLI WYSIWYS, app decoded-intent card, co-sign gate, and
 * migration shadow-diff all read from, so they can never disagree on what a tx
 * decodes to.
 *
 * Ported from the Go reference `internal/safety/envelope.go` (`Envelope`),
 * trimmed to the pure-crypto core: the agent-layer fields there
 * (Direction/intent annotations) are intentionally left out — those are
 * consumers of the Envelope, not part of it.
 */

/** Broad technology family of a chain. */
export type ChainFamily = 'evm' | 'cosmos'

/** Token reference for the asset being moved. */
export type AssetRef = {
  /** Canonical uppercase ticker when known: "ETH", "USDC", "ATOM". Empty if unknown. */
  symbol: string
  /**
   * Token contract / denom for non-native assets.
   * EVM: ERC-20 contract address (checksummed). Cosmos: the coin denom (e.g. "uatom").
   * Empty for native EVM transfers.
   */
  contract: string
  /** Decimals when known; 0 means unknown (display the raw atomic value). */
  decimals: number
}

/** Kind of effect inferred from the decoded calldata / message. */
export type EnvelopeKind = 'transfer' | 'approve' | 'delegate' | 'undelegate' | 'contractCall' | 'unknown'

/**
 * Decoded, chain-agnostic representation of a pending transaction.
 *
 * The zero/failed value has `decoded: false` and a populated `decodeError`;
 * callers MUST check `decoded` before trusting any other field.
 */
export type Envelope = {
  /**
   * Canonical chain identifier.
   * EVM: for typed (EIP-1559/2930) txs the on-wire numeric EIP-155 id is
   * resolved to the symbolic chain name ("base", "ethereum") so the policy
   * layer can match it (numeric string fallback for chains not in the map);
   * for legacy (type-0) txs the caller's chain hint stands.
   * Cosmos: the chain-id hint passed in ("cosmoshub-4"), since proto3 tx bytes
   * do not embed the chain id.
   */
  chain: string

  /** Broad technology family for routing. */
  family: ChainFamily

  /** Effect kind inferred from the decoded bytes. */
  kind: EnvelopeKind

  /**
   * Destination address in canonical form for the family.
   * EVM: checksummed 0x hex. Cosmos: bech32.
   * For an ERC-20 `transfer`, this is the token recipient (NOT the contract).
   * Empty when the tx has no single recipient.
   */
  recipient: string

  /** Token being moved. */
  asset: AssetRef

  /**
   * Transfer amount in raw atomic units (wei, uatom, ...) as a decimal string
   * so it survives JSON round-trips without bigint loss. Empty when unknown.
   */
  amount: string

  /**
   * Approved spender for approve/permit transactions (EVM). Empty otherwise.
   */
  spender: string

  /** True when the bytes decoded successfully. */
  decoded: boolean

  /** Human-readable reason when `decoded` is false. */
  decodeError: string
}

/** Input to {@link decodeFromToolResult}. */
export type DecodeFromToolResultInput = {
  /** MCP tool name that produced the result (e.g. "execute_send"). Optional context only. */
  toolName?: string
  /**
   * Raw tx bytes to decode.
   * EVM: a `0x`-prefixed hex string of the unsigned RLP tx, OR a Uint8Array.
   * Cosmos: base64 proto3 tx bytes (TxRaw), OR a Uint8Array.
   * When omitted, `args` is consulted for `unsigned_payload` (EVM) /
   * `cosmos_payload` (Cosmos).
   */
  payload?: string | Uint8Array
  /**
   * Chain family hint. Required to pick the EVM vs Cosmos decoder when it can
   * not be inferred from the payload shape.
   */
  family?: ChainFamily
  /**
   * Chain hint used to populate `Envelope.chain` for Cosmos (proto3 bytes carry
   * no chain id) and as the fallback for legacy EVM txs.
   */
  chain?: string
  /**
   * Tool-call arguments JSON (or object). Source of the payload when `payload`
   * is omitted, and the fill-only source for the asset symbol (which is not on
   * the wire for native/CW20). NEVER overrides a bytes-decoded recipient/amount.
   */
  args?: string | Record<string, unknown>
}
