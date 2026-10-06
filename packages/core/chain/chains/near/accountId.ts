/**
 * NEAR account-ID grammar (docs.near.org/protocol/accounts-contracts/account-id):
 * 2–64 characters, lowercase letters, digits and `.`, `-`, `_`, no leading,
 * trailing or doubled separator.
 *
 * `CoinTypeExt.validate(CoinType.near, ...)` is NOT this check: it accepts
 * uppercase and `0x`-prefixed hex and rejects named accounts.
 */

/** Implicit accounts are the lowercase hex form of an Ed25519 public key. */
const IMPLICIT_ACCOUNT_ID = /^[0-9a-f]{64}$/

/**
 * `0x…` (NEP-518) and `0s…` (NEP-616) are different account families the native
 * transfer path does not support, so they are rejected rather than accepted as
 * named accounts.
 */
const UNSUPPORTED_HEX_PREFIXED_ACCOUNT = /^(0x|0s)[0-9a-f]{40}$/

/** Lowest-common-denominator named form: alphanumeric groups joined by one separator. */
const NAMED_ACCOUNT_ID = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/

const MIN_ACCOUNT_ID_LENGTH = 2
const MAX_ACCOUNT_ID_LENGTH = 64

export const isNearImplicitAccountId = (accountId: string) => IMPLICIT_ACCOUNT_ID.test(accountId)

/** Throws unless the key is a 32-byte Ed25519 public key in lowercase hex, the spelling an implicit account uses. */
export const assertNearEd25519PublicKeyHex = (hexPublicKey: string) => {
  if (!IMPLICIT_ACCOUNT_ID.test(hexPublicKey)) {
    throw new Error(`Invalid NEAR public key: ${hexPublicKey} is not a 32-byte Ed25519 key in lowercase hex`)
  }
}

export const isNearAccountId = (accountId: string) => {
  if (accountId.length < MIN_ACCOUNT_ID_LENGTH || accountId.length > MAX_ACCOUNT_ID_LENGTH) {
    return false
  }

  if (isNearImplicitAccountId(accountId)) {
    return true
  }

  if (UNSUPPORTED_HEX_PREFIXED_ACCOUNT.test(accountId)) {
    return false
  }

  return NAMED_ACCOUNT_ID.test(accountId)
}
