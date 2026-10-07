import { assertSwapCoinIsSigningCoin } from '@vultisig/core-chain/swap/general/knownAggregatorRouters'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'

import { getKeysignSwapPayload } from './getKeysignSwapPayload'

/**
 * Refuses an aggregator swap payload (every provider, every chain) whose sold coin is missing or is
 * not the keysign coin. Each signer builds for the keysign coin while co-signers display the
 * payload's coin, so the two must be the same coin before anything is signed or priced.
 */
export const assertKeysignSwapSellsSigningCoin = (keysignPayload: KeysignPayload): void => {
  const swapPayload = getKeysignSwapPayload(keysignPayload)
  if (!swapPayload || !('general' in swapPayload)) return

  assertSwapCoinIsSigningCoin(swapPayload.general.fromCoin, shouldBePresent(keysignPayload.coin))
}
