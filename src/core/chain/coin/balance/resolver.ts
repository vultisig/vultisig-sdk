import { Chain } from '../../Chain'
import { AccountCoinKey } from '../AccountCoin'
import { Resolver } from '../../../../lib/utils/types/Resolver'

export type CoinBalanceResolverInput<T extends Chain = Chain> =
  AccountCoinKey<T>

export type CoinBalanceResolver<T extends Chain = Chain> = Resolver<
  CoinBalanceResolverInput<T>,
  Promise<bigint>
>
