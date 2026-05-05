import { Chain, CosmosChain } from '@vultisig/core-chain/Chain'

import { areEqualCoins, CoinKey } from '../../coin/Coin'

const cosmosGasLimitRecord: Record<CosmosChain, bigint> = {
  [Chain.Cosmos]: 200000n,
  [Chain.Osmosis]: 300000n,
  [Chain.Kujira]: 200000n,
  [Chain.Dydx]: 200000n,
  [Chain.Noble]: 200000n,
  [Chain.Akash]: 200000n,
  [Chain.Terra]: 300000n,
  // TerraClassic default covers both bank.MsgSend (uluna ~80k) and
  // ibc.MsgTransfer (~150-200k), with margin for chain load. uusd
  // (USTC) MsgSend has its own 1M override below for the burn-tax /
  // treasury post-handler path; IBC `MsgTransfer` is exempt from the
  // burn tax (per classic-terra/core fee_tax.go::FilterMsgAndComputeTax)
  // so it falls through to this default.
  [Chain.TerraClassic]: 400000n,
  [Chain.THORChain]: 20000000n,
  [Chain.MayaChain]: 2000000000n,
}

export const getCosmosGasLimit = (coin: CoinKey<CosmosChain>): bigint => {
  if (areEqualCoins(coin, { chain: Chain.TerraClassic, id: 'uusd' })) {
    return 1_000_000n
  }

  return cosmosGasLimitRecord[coin.chain]
}
