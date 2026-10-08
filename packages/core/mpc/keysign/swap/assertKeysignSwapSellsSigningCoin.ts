import { assertSwapCoinIsSigningCoin } from '@vultisig/core-chain/swap/general/knownAggregatorRouters'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'

import { getKeysignChain } from '../utils/getKeysignChain'
import { getKeysignSwapPayload, isSecuredAssetWithdrawal } from './getKeysignSwapPayload'

/**
 * Refuses a swap payload (every provider and chain, THORChain and Maya included) whose sold coin is
 * missing or is not the keysign coin. Each signer builds for the keysign coin while co-signers
 * display the payload's coin, so the two must be the same coin before anything is signed or priced.
 * A secured-asset withdrawal is exempt: its native payload names the L1 asset being redeemed, and
 * the THORChain deposit is built from that asset.
 */
export const assertKeysignSwapSellsSigningCoin = (keysignPayload: KeysignPayload): void => {
  const swapPayload = getKeysignSwapPayload(keysignPayload)
  if (!swapPayload) return

  if ('native' in swapPayload) {
    const chain = getKeysignChain(keysignPayload)
    if (isSecuredAssetWithdrawal({ chain, keysignPayload, native: swapPayload.native })) return
  }

  const { fromCoin } = 'native' in swapPayload ? swapPayload.native : swapPayload.general
  assertSwapCoinIsSigningCoin(fromCoin, shouldBePresent(keysignPayload.coin))
}
