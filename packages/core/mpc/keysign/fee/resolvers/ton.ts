import { tonConfig } from '@vultisig/core-chain/chains/ton/config'
import { CoinKey } from '@vultisig/core-chain/coin/Coin'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'

import { getKeysignTonGasless } from '../../ton/gasless'
import { getKeysignCoin } from '../../utils/getKeysignCoin'
import { FeeAmountResolver } from '../resolver'

export const getTonFeeAmount = (coin: CoinKey) =>
  isFeeCoin(coin) ? tonConfig.baseFee : tonConfig.baseFee + tonConfig.jettonAmount

/**
 * The fee a TON payload costs its sender: the static TON reserve for a direct
 * send, or — for a relayed (gasless) send — the relay's commission, which is
 * denominated in the jetton being sent rather than in TON. `getKeysignFeeCoin`
 * says which.
 */
export const tonFeeAmountResolver: FeeAmountResolver = ({ keysignPayload }) => {
  const gasless = getKeysignTonGasless(keysignPayload)

  return gasless ? BigInt(gasless.commission) : getTonFeeAmount(getKeysignCoin(keysignPayload))
}
