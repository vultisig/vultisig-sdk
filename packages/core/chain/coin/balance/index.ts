import { ChainKind, getChainKind } from '@vultisig/core-chain/ChainKind'

import { CoinBalanceResolver } from './resolver'
import { getBittensorCoinBalance } from './resolvers/bittensor'
import { getCardanoCoinBalance } from './resolvers/cardano'
import { getCosmosCoinBalance } from './resolvers/cosmos'
import { getEvmCoinBalance } from './resolvers/evm'
import { getPolkadotCoinBalance } from './resolvers/polkadot'
import { getQbtcCoinBalance } from './resolvers/qbtc'
import { getRippleCoinBalance } from './resolvers/ripple'
import { getSolanaCoinBalance } from '@vultisig/core-chain/coin/balance/resolvers/solana'
import { getSuiCoinBalance } from './resolvers/sui'
import { getTonCoinBalance } from './resolvers/ton'
import { getTronCoinBalance } from './resolvers/tron'
import { getUtxoCoinBalance } from './resolvers/utxo'

const resolvers: Record<ChainKind, CoinBalanceResolver<any>> = {
  utxo: getUtxoCoinBalance,
  cosmos: getCosmosCoinBalance,
  sui: getSuiCoinBalance,
  evm: getEvmCoinBalance,
  ton: getTonCoinBalance,
  ripple: getRippleCoinBalance,
  polkadot: getPolkadotCoinBalance,
  bittensor: getBittensorCoinBalance,
  solana: getSolanaCoinBalance,
  tron: getTronCoinBalance,
  cardano: getCardanoCoinBalance,
  qbtc: getQbtcCoinBalance,
}

export const getCoinBalance: CoinBalanceResolver = async input =>
  resolvers[getChainKind(input.chain)](input)
