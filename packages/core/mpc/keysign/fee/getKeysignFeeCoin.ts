import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { Coin } from '@vultisig/core-chain/coin/Coin'

import { KeysignPayload } from '../../types/vultisig/keysign/v1/keysign_message_pb'
import { getKeysignTonGasless } from '../ton/gasless'
import { getKeysignCoin } from '../utils/getKeysignCoin'

/**
 * The coin a payload's fee (`getFeeAmount`) is denominated in. That is the
 * chain's native coin for every send but a relayed (gasless) TON one, whose
 * relay commission is charged in the jetton being sent — so a fee display or
 * a balance check must format and debit the fee in that jetton's units.
 */
export const getKeysignFeeCoin = (keysignPayload: KeysignPayload): Coin => {
  const coin = getKeysignCoin(keysignPayload)

  return getKeysignTonGasless(keysignPayload) ? coin : chainFeeCoin[coin.chain]
}
