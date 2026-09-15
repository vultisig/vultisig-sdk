import { Chain } from '@vultisig/core-chain/Chain'
import { bittensorConfig } from '@vultisig/core-chain/chains/bittensor/config'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { getBittensorCoinBalance } from '@vultisig/core-chain/coin/balance/resolvers/bittensor'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { parseNonNegativeBigInt } from '@vultisig/lib-utils/bigint/parseNonNegativeBigInt'

import { BuildKeysignPayloadError } from '../error'

type AssertBittensorDestinationStaysAliveInput = {
  coin: AccountCoin
  keysignPayload: KeysignPayload
}

/**
 * Rejects a Bittensor transfer the chain would refuse with `ExistentialDeposit`:
 * one that leaves the destination holding less than the 500 rao minimum, which
 * is only possible when the account is new or already reaped.
 *
 * Meant for the end of the payload build, once the amount is the one that will
 * be signed — fee refinement can lower it, so a check on the requested amount
 * could pass and the signed transfer still fail on-chain with the ceremony
 * already paid for. Reads the destination balance only for a sub-deposit
 * amount, so an ordinary send costs no extra request. Raised as a
 * [BuildKeysignPayloadError] because it is bad input, not a transient failure:
 * callers stop retrying and show it.
 */
export const assertBittensorDestinationStaysAlive = async ({
  coin,
  keysignPayload,
}: AssertBittensorDestinationStaysAliveInput): Promise<void> => {
  if (coin.chain !== Chain.Bittensor) {
    return
  }

  const amount = parseNonNegativeBigInt(keysignPayload.toAmount)
  const { existentialDeposit } = bittensorConfig
  if (amount >= existentialDeposit) {
    return
  }

  const { toAddress } = keysignPayload
  const destinationBalance = await getBittensorCoinBalance({ chain: Chain.Bittensor, address: toAddress })
  if (destinationBalance + amount < existentialDeposit) {
    throw new BuildKeysignPayloadError(
      'bittensor-destination-below-existential-deposit',
      `Cannot send ${amount} rao to ${toAddress}: the destination would hold less than the ` +
        `${existentialDeposit} rao existential deposit and Bittensor rejects the transfer.`
    )
  }
}
