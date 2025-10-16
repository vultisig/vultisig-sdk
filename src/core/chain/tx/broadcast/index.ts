import { ChainKind, getChainKind } from '../../ChainKind'

import { BroadcastTxResolver } from './resolver'

/**
 * Dynamically loads the appropriate broadcast resolver for the given chain
 * This approach reduces bundle size and avoids loading unused code
 */
async function getBroadcastResolver(chainKind: ChainKind): Promise<BroadcastTxResolver<any>> {
  switch (chainKind) {
    case 'cardano':
    case 'utxo':
      return (await import('./resolvers/utxo')).broadcastUtxoTx
    case 'cosmos':
      return (await import('./resolvers/cosmos')).broadcastCosmosTx
    case 'evm':
      return (await import('./resolvers/evm')).broadcastEvmTx
    case 'polkadot':
      return (await import('./resolvers/polkadot')).broadcastPolkadotTx
    case 'ripple':
      return (await import('./resolvers/ripple')).broadcastRippleTx
    case 'solana':
      return (await import('./resolvers/solana')).broadcastSolanaTx
    case 'sui':
      return (await import('./resolvers/sui')).broadcastSuiTx
    case 'ton':
      return (await import('./resolvers/ton')).broadcastTonTx
    case 'tron':
      return (await import('./resolvers/tron')).broadcastTronTx
    default:
      throw new Error(`Unsupported chain kind: ${chainKind}`)
  }
}

export const broadcastTx: BroadcastTxResolver = async input => {
  const chainKind = getChainKind(input.chain)

  // Only load the resolver we actually need
  const resolver = await getBroadcastResolver(chainKind)

  return resolver(input)
}
