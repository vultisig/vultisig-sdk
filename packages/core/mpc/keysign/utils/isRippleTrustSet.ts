import { parseRippleTokenId } from '@vultisig/core-chain/chains/ripple/issuedCurrency'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { attempt } from '@vultisig/lib-utils/attempt'

import { TransactionType } from '../../types/vultisig/keysign/v1/blockchain_specific_pb'
import { getBlockchainSpecificValue } from '../chainSpecific/KeysignChainSpecific'

/**
 * Whether the payload's shape can describe an issued-currency operation.
 *
 * Deliberately broad, and used only while originating a TrustSet discriminator.
 *
 * Do not use this to decide what a payload *is*: an issued-currency Payment has
 * the same shape. Use {@link originatesRippleTrustSet} when originating.
 *
 * A verbatim dApp transaction (`signRipple`) is excluded because it is signed
 * exactly as given and never rebuilt from the coin.
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
 * Legacy trust-line callers address the issuer. This remains a compatibility
 * heuristic, not operation identity: redemption Payments also address their
 * issuer. Ordinary send builders must explicitly select Payment instead.
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
 * Whether this Ripple payload explicitly describes a TrustSet. The non-native
 * coin shape is deliberately insufficient because an issued-currency Payment
 * has the same shape. Current signers require the discriminator; an older
 * signer that still infers TrustSet for an ordinary token Payment derives a
 * different preimage, making that mixed-version ceremony fail closed.
 */
export const isRippleTrustSet = (keysignPayload: KeysignPayload): boolean => {
  const { transactionType } = getBlockchainSpecificValue(keysignPayload.blockchainSpecific, 'rippleSpecific')

  return transactionType === TransactionType.RIPPLE_TRUST_SET
}
