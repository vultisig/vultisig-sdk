export enum ClaimProofErrorCode {
  /** `proof` is missing or empty */
  MissingProof = 'QBTC_CLAIM_PROOF_MISSING_PROOF',
  /** `message_hash` is not a 64-char hex string */
  InvalidMessageHash = 'QBTC_CLAIM_PROOF_INVALID_MESSAGE_HASH',
  /** `address_hash` is not a 40-char hex string */
  InvalidAddressHash = 'QBTC_CLAIM_PROOF_INVALID_ADDRESS_HASH',
  /** `qbtc_address_hash` is not a 64-char hex string */
  InvalidQbtcAddressHash = 'QBTC_CLAIM_PROOF_INVALID_QBTC_ADDRESS_HASH',
  /** `pub_key_hash_sha256` is not a 64-char hex string */
  InvalidPubKeyHashSha256 = 'QBTC_CLAIM_PROOF_INVALID_PUB_KEY_HASH_SHA256',
  /** `tx_hash` is present but not a 64-char hex string */
  InvalidTxHash = 'QBTC_CLAIM_PROOF_INVALID_TX_HASH',
}

/**
 * Thrown by {@link assertValidClaimProofResponse} when the QBTC proof
 * service's response doesn't match the expected field shapes. Keeps this
 * domain-scoped (rather than reusing SDK-level `VaultError`) since
 * `@vultisig/core-chain` doesn't depend on `@vultisig/sdk` — mirrors the
 * `SwapError` / `SwapErrorCode` pattern used elsewhere in this package.
 */
export class ClaimProofError extends Error {
  readonly name = 'ClaimProofError'

  constructor(
    public readonly code: ClaimProofErrorCode,
    message: string
  ) {
    super(message)
  }
}
