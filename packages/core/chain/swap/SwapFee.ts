import { CoinAmount, CoinKey } from '@vultisig/core-chain/coin/Coin'

export type SwapFee = CoinKey & CoinAmount

export type SwapFees = {
  network: SwapFee
  swap?: SwapFee
}
