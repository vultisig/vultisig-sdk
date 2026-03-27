import { Chain } from '@vultisig/core-chain/Chain'
import { AccountCoinKey } from '@vultisig/core-chain/coin/AccountCoin'
import { Resolver } from '@vultisig/lib-utils/types/Resolver'

export type CoinBalanceResolverInput<T extends Chain = Chain> =
  AccountCoinKey<T>

export type CoinBalanceResolver<T extends Chain = Chain> = Resolver<
  CoinBalanceResolverInput<T>,
  Promise<bigint>
>
