import { CoinKey, CoinMetadata } from '@vultisig/core-chain/coin/Coin'

import { getNativeSwapDecimals } from './getNativeSwapDecimals'

type CoinWithDecimals = CoinKey & Pick<CoinMetadata, 'decimals'>

export function rebaseDecimalAmount(value: bigint, fromDecimals: number, toDecimals: number): bigint {
  if (fromDecimals === toDecimals) {
    return value
  }
  if (toDecimals > fromDecimals) {
    return value * 10n ** BigInt(toDecimals - fromDecimals)
  }
  return value / 10n ** BigInt(fromDecimals - toDecimals)
}

export const nativeSwapAmountToCoinBaseUnit = (value: bigint, coin: CoinWithDecimals): bigint =>
  rebaseDecimalAmount(value, getNativeSwapDecimals(coin), coin.decimals)
