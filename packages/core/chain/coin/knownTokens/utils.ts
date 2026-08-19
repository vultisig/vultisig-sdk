import { Chain } from '@vultisig/core-chain/Chain'
import { getChainKind } from '@vultisig/core-chain/ChainKind'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'

import { CoinKey, KnownCoin, Token } from '../Coin'
import { knownTokensIndex } from '.'

const getKnownToken = <C extends Chain>(key: Token<CoinKey<C>>): (KnownCoin & { chain: C }) | undefined => {
  const lookupId = getChainKind(key.chain) === 'evm' ? key.id.toLowerCase() : key.id
  return knownTokensIndex[key.chain]?.[lookupId] as (KnownCoin & { chain: C }) | undefined
}

export const assertKnownToken = <C extends Chain>(key: Token<CoinKey<C>>): KnownCoin & { chain: C } =>
  shouldBePresent(getKnownToken(key))
