import { Chain } from '@vultisig/core-chain/Chain'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'

import { CoinKey, KnownCoin, Token } from '../Coin'
import { knownTokensIndex } from '.'
import { getKnownTokenIndexId } from './getKnownTokenIndexId'

export const getKnownToken = <C extends Chain>(key: Token<CoinKey<C>>): (KnownCoin & { chain: C }) | undefined => {
  return knownTokensIndex[key.chain]?.[getKnownTokenIndexId(key.chain, key.id)] as
    | (KnownCoin & { chain: C })
    | undefined
}

export const assertKnownToken = <C extends Chain>(key: Token<CoinKey<C>>): KnownCoin & { chain: C } =>
  shouldBePresent(getKnownToken(key))
