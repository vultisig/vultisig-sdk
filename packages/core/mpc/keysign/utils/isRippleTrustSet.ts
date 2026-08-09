import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'

import { TransactionType } from '../../types/vultisig/keysign/v1/blockchain_specific_pb'
import { getBlockchainSpecificValue } from '../chainSpecific/KeysignChainSpecific'

/**
 * Whether the payload's shape alone reads as a TrustSet, i.e. how every signer
 * that predates `RippleSpecific.transaction_type` decides.
 *
 * This is what the builder uses to know it must set the field, and what the
 * signer falls back to when the field is absent. Keeping one definition is the
 * point: if the two drifted, a payload could be built as one operation and
 * signed as the other.
 *
 * A verbatim dApp transaction (`signRipple`) is excluded — it is signed exactly
 * as given and never rebuilt from the coin.
 */
export const hasRippleTrustSetShape = ({ signData, coin }: KeysignPayload): boolean =>
  signData.case !== 'signRipple' && !!coin && !coin.isNativeToken && !!coin.contractAddress

/**
 * Whether this Ripple payload describes a TrustSet — opening or modifying a
 * trust line, where the keysign amount is the trust-line LIMIT — rather than a
 * Payment that transfers the token.
 *
 * A non-native Ripple coin cannot say this on its own: the same
 * `(currency, issuer)` pair means either operation, and the two produce
 * different signed bytes. `RippleSpecific.transaction_type` states it
 * explicitly, so it wins when present.
 *
 * The shape fallback is load-bearing for MPC byte-parity, not a convenience.
 * Clients shipped before the field infer TrustSet from a non-native coin alone,
 * so honouring that inference keeps a TrustSet byte-identical across a
 * mixed-version committee. Dropping it would break every signer already in the
 * field.
 */
export const isRippleTrustSet = (keysignPayload: KeysignPayload): boolean => {
  const { transactionType } = getBlockchainSpecificValue(keysignPayload.blockchainSpecific, 'rippleSpecific')

  if (transactionType === TransactionType.RIPPLE_TRUST_SET) {
    return true
  }

  return hasRippleTrustSetShape(keysignPayload)
}
