import { Chain } from '../../Chain'
import { AccountCoin } from '../AccountCoin'
import { Resolver } from '../../../../lib/utils/types/Resolver'

export type FindCoinsResolverInput<T extends Chain = Chain> = {
  address: string
  chain: T
}

export type FindCoinsResolver<T extends Chain = Chain> = Resolver<
  FindCoinsResolverInput<T>,
  Promise<AccountCoin[]>
>
