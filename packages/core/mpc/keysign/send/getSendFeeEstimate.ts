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
const toFeeQuoteInput = (input: BuildSendKeysignPayloadInput): BuildSendKeysignPayloadInput => {
  // Native SOL fees depend on the signatures and compute budget, not the
  // transferred lamports. Quote a zero-value payload so amount refinement
  // does not reject a balance below the fee before MAX can return zero.
  // The send preparation path still builds and validates the real amount.
  if (input.coin.chain === Chain.Solana && isFeeCoin(input.coin)) {
    return { ...input, amount: 0n }
  }
  return input.tonGasless && input.coin.chain === Chain.Ton && !isFeeCoin(input.coin)
    ? { ...input, amount: smallestJettonTransfer, sendMaxAmount: false }
    : input
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
