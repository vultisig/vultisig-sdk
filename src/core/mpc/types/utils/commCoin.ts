import { create } from '@bufbuild/protobuf'
import { Chain } from '../../../chain/Chain'
import { AccountCoin } from '../../../chain/coin/AccountCoin'
import { isFeeCoin } from '../../../chain/coin/utils/isFeeCoin'
import {
  Coin as CommCoin,
  CoinSchema,
} from '../vultisig/keysign/v1/coin_pb'

export const fromCommCoin = <T extends Chain = Chain>(
  coin: CommCoin
): AccountCoin<T> => {
  return {
    id: coin.contractAddress || undefined,
    chain: coin.chain as T,
    address: coin.address,
    ticker: coin.ticker,
    logo: coin.logo,
    priceProviderId: coin.priceProviderId,
    decimals: coin.decimals,
  }
}

type ToCommCoinInput = AccountCoin & {
  hexPublicKey: string
}

export const toCommCoin = (coin: ToCommCoinInput): CommCoin => {
  const isNativeToken = isFeeCoin(coin)

  return create(CoinSchema, {
    chain: coin.chain,
    ticker: coin.ticker,
    address: coin.address,
    contractAddress: isNativeToken ? '' : coin.id,
    hexPublicKey: coin.hexPublicKey,
    isNativeToken: isNativeToken,
    logo: coin.logo,
    priceProviderId: coin.priceProviderId ?? '',
    decimals: coin.decimals,
  })
}
