import { ChainKind, getChainKind } from '@vultisig/core-chain/ChainKind'

import { BroadcastTxResolver } from './resolver'
import { broadcastBittensorTx } from './resolvers/bittensor'
import { broadcastCardanoTx } from './resolvers/cardano'
import { broadcastCosmosTx } from './resolvers/cosmos'
import { broadcastEvmTx } from './resolvers/evm'
import { broadcastPolkadotTx } from './resolvers/polkadot'
import { broadcastQbtcTx } from './resolvers/qbtc'
import { broadcastRippleTx } from './resolvers/ripple'
import { broadcastSolanaTx } from './resolvers/solana'
import { broadcastSuiTx } from './resolvers/sui'
import { broadcastTonTx } from './resolvers/ton'
import { broadcastTronTx } from './resolvers/tron'
import { broadcastUtxoTx } from './resolvers/utxo'
import { withTransientBroadcastRetry } from './transientRetry'

const resolvers: Record<ChainKind, BroadcastTxResolver<any>> = {
  bittensor: broadcastBittensorTx,
  cardano: broadcastCardanoTx,
  cosmos: broadcastCosmosTx,
  evm: broadcastEvmTx,
  polkadot: broadcastPolkadotTx,
  qbtc: broadcastQbtcTx,
  ripple: broadcastRippleTx,
  solana: broadcastSolanaTx,
  sui: broadcastSuiTx,
  ton: broadcastTonTx,
  utxo: broadcastUtxoTx,
  tron: broadcastTronTx,
}

const hasResolverOwnedRetry = (chainKind: ChainKind): boolean => chainKind === 'evm' || chainKind === 'solana'

export const broadcastTx: BroadcastTxResolver = input => {
  const chainKind = getChainKind(input.chain)
  const resolver = resolvers[chainKind]

  if (hasResolverOwnedRetry(chainKind)) {
    return resolver(input)
  }

  return withTransientBroadcastRetry(() => resolver(input))
}
