/**
 * A validator row from `getVoteAccounts` plus an optional metadata enrichment
 * struct (name / logo / APY / score) populated by the metadata-provider seam.
 * The base row is decoded straight off the RPC; `ValidatorMetadata` starts
 * empty so the read layer can ship before the enrichment source is wired.
 *
 * Port of iOS `SolanaValidator` / `ValidatorMetadata`.
 */

/**
 * Off-chain enrichment for a validator. All optional — populated from a
 * metadata source; the base read layer leaves it empty.
 */
export type ValidatorMetadata = {
  name?: string
  logoUrl?: string
  /** Estimated APY as a fraction (e.g. 0.067 for 6.7%). */
  apyEstimate?: number
  /** A 0–100 quality score from the metadata source. */
  score?: number
}

export type SolanaValidator = {
  /** Vote account address — the delegation target a stake account points at. */
  votePubkey: string
  /** The validator's identity (node) pubkey. */
  nodePubkey: string
  /** Total active stake delegated to this validator, in lamports. */
  activatedStake: bigint
  /** Commission percentage (0–100) the validator takes from rewards. */
  commission: number
  /** Whether this vote account has voted in the current epoch. */
  epochVoteAccount: boolean
  /**
   * `true` when the validator is in the delinquent set (not voting). Carried
   * from which `getVoteAccounts` bucket the row came from, not the wire.
   */
  isDelinquent: boolean
  /** Enrichment from the metadata provider — name, logo, APY estimate, score. */
  metadata: ValidatorMetadata
}

/**
 * `prefix…suffix` form of a base58 pubkey for compact display. Returns the
 * input unchanged when it is too short to truncate meaningfully.
 */
export const truncatedPubkey = (pubkey: string, prefix = 4, suffix = 4): string =>
  pubkey.length > prefix + suffix + 1 ? `${pubkey.slice(0, prefix)}…${pubkey.slice(-suffix)}` : pubkey

/**
 * Name to show in the picker: the enriched metadata name when present,
 * otherwise a truncated vote pubkey. Keeps the display layer independent of
 * whether the metadata provider returned anything.
 */
export const validatorDisplayName = (validator: SolanaValidator): string => {
  const name = validator.metadata.name?.trim()
  if (name) {
    return name
  }
  return truncatedPubkey(validator.votePubkey)
}

/**
 * The validator logo URL, or `undefined` when no metadata source supplied one —
 * the display layer then renders a deterministic placeholder.
 */
export const validatorLogoUrl = (validator: SolanaValidator): string | undefined => {
  const raw = validator.metadata.logoUrl?.trim()
  return raw ? raw : undefined
}
