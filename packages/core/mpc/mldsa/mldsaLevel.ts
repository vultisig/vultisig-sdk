/**
 * FIPS 204 parameter set for post-quantum keygen and keysign (ML-DSA-65).
 * Every co-signer must use the same level: a keyshare refuses a signing
 * setup at any other level.
 */
export const mldsaLevel = 65
