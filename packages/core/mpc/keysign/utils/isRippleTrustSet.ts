import { parseRippleTokenId } from '@vultisig/core-chain/chains/ripple/issuedCurrency'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { attempt } from '@vultisig/lib-utils/attempt'

import { TransactionType } from '../../types/vultisig/keysign/v1/blockchain_specific_pb'
import { getBlockchainSpecificValue } from '../chainSpecific/KeysignChainSpecific'

/**
 * Whether the payload's shape alone reads as a TrustSet — i.e. how every signer
 * that predates `RippleSpecific.transaction_type` decides.
 *
 * Deliberately broad, and **only** for the signing fallback. Clients already in
 * the field infer TrustSet from a non-native Ripple coin alone, so honouring
 * that same inference is what keeps a TrustSet byte-identical across a
 * mixed-version committee. Narrowing it would break MPC parity with every
 * signer already released.
 *
 * Do not use this to decide what a payload *is*: an issued-currency Payment has
 * the same shape. Use {@link originatesRippleTrustSet} when originating.
 *
 * A verbatim dApp transaction (`signRipple`) is excluded — it is signed exactly
 * as given and never rebuilt from the coin.
 */
export const hasRippleTrustSetShape = ({ signData, coin }: KeysignPayload): boolean =>
  signData.case !== 'signRipple' && !!coin && !coin.isNativeToken && !!coin.contractAddress

/**
 * Whether this payload is being originated as a TrustSet, and so should declare
 * itself one on the wire.
 *
 * Stricter than {@link hasRippleTrustSetShape} because declaring is an
 * assertion, not a guess. A send of an issued currency has the identical coin
 * shape, and stamping that as a TrustSet would make every signer agree to build
 * one — turning what used to be a safe divergence into a completed ceremony
 * over an operation the user never asked for.
 *
 * A TrustSet is addressed to the *issuer*: it is the party being trusted. A
 * Payment is addressed to a recipient. That is what separates them here.
 */
export const originatesRippleTrustSet = (keysignPayload: KeysignPayload): boolean => {
  if (!hasRippleTrustSetShape(keysignPayload)) {
    return false
  }

  const { coin, toAddress } = keysignPayload
  const issuer = attempt(() => parseRippleTokenId(coin?.contractAddress ?? '').issuer)

  return 'data' in issuer && issuer.data === toAddress
}

/**
 * Whether this Ripple payload describes a TrustSet — opening or modifying a
 * trust line, where the keysign amount is the trust-line LIMIT — rather than a
 * Payment that transfers the token.
 *
 * A non-native Ripple coin cannot say this on its own: the same
 * `(currency, issuer)` pair means either operation, and the two produce
 * different signed bytes. `RippleSpecific.transaction_type` states it
 * explicitly, so it wins when present, and the shape decides only when it is
 * absent — which is the mixed-version case documented on
 * {@link hasRippleTrustSetShape}.
 */
export const isRippleTrustSet = (keysignPayload: KeysignPayload): boolean => {
  const { transactionType } = getBlockchainSpecificValue(keysignPayload.blockchainSpecific, 'rippleSpecific')

  if (transactionType === TransactionType.RIPPLE_TRUST_SET) {
    return true
  }

  return hasRippleTrustSetShape(keysignPayload)
}
