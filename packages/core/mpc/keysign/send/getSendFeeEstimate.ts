import { Chain } from '@vultisig/core-chain/Chain'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'
import { getFeeAmount } from '@vultisig/core-mpc/keysign/fee'
import { getBlockchainSpecificValue } from '@vultisig/core-mpc/keysign/chainSpecific/KeysignChainSpecific'
import { getKeysignChain } from '@vultisig/core-mpc/keysign/utils/getKeysignChain'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'

import { buildSendKeysignPayload, BuildSendKeysignPayloadInput } from './build'

/** The smallest transfer a jetton can carry, in its minimal units. */
const smallestJettonTransfer = 1n

/**
 * A gasless TON jetton send is priced by the relay, which refuses to quote any
 * transfer that does not leave room for its commission — and callers estimate
 * with the full balance to learn what that room is. The commission does not
 * depend on the amount, so the fee is quoted for the smallest transfer instead
 * of the caller's; the send itself is still built with the real amount.
 */
const isTonGaslessJetton = (input: BuildSendKeysignPayloadInput) =>
  input.tonGasless && input.coin.chain === Chain.Ton && !isFeeCoin(input.coin)

/**
 * NEAR's gas reservation depends on the receiver, not the amount, and a NEAR
 * send that cannot afford amount + reservation + storage is refused rather
 * than clamped — so a full-balance estimate would always be refused.
 */
const smallestNearTransfer = 1n

const toFeeQuoteInput = (input: BuildSendKeysignPayloadInput): BuildSendKeysignPayloadInput => {
  if (isTonGaslessJetton(input)) return { ...input, amount: smallestJettonTransfer, sendMaxAmount: false }
  if (input.coin.chain === Chain.Near) return { ...input, amount: smallestNearTransfer, sendMaxAmount: false }
  return input
}

export const getSendFeeEstimate = async (input: BuildSendKeysignPayloadInput): Promise<bigint> => {
  const keysignPayload = await buildSendKeysignPayload(toFeeQuoteInput(input))

  if (getKeysignChain(keysignPayload) === Chain.QBTC) {
    const cosmosSpecific = getBlockchainSpecificValue(keysignPayload.blockchainSpecific, 'cosmosSpecific')
    return cosmosSpecific.gas
  }

  return await getFeeAmount({
    keysignPayload,
    walletCore: input.walletCore,
    publicKey: shouldBePresent(input.publicKey, 'publicKey required for fee estimate on this chain'),
  })
}
