import { Chain } from '../../Chain'
import { ChainKind, getChainKind } from '../../ChainKind'

import { SigningOutput } from '../../tw/signingOutput'
import { TxHashResolver } from './resolver'

type GetTxHashInput = {
  chain: Chain
  tx: SigningOutput<Chain>
}

/**
 * Dynamically loads the appropriate hash resolver for the given chain
 * This approach reduces bundle size and avoids loading unused code
 */
async function getHashResolver(chainKind: ChainKind): Promise<TxHashResolver<any>> {
  switch (chainKind) {
    case 'cardano':
      return (await import('./resolvers/cardano')).getCardanoTxHash
    case 'cosmos':
      return (await import('./resolvers/cosmos')).getCosmosTxHash
    case 'evm':
      return (await import('./resolvers/evm')).getEvmTxHash
    case 'polkadot':
      return (await import('./resolvers/polkadot')).getPolkadotTxHash
    case 'ripple':
      return (await import('./resolvers/ripple')).getRippleTxHash
    case 'solana':
      return (await import('./resolvers/solana')).getSolanaTxHash
    case 'sui':
      return (await import('./resolvers/sui')).getSuiTxHash
    case 'ton':
      return (await import('./resolvers/ton')).getTonTxHash
    case 'tron':
      return (await import('./resolvers/tron')).getTronTxHash
    case 'utxo':
      return (await import('./resolvers/utxo')).getUtxoTxHash
    default:
      throw new Error(`Unsupported chain kind: ${chainKind}`)
  }
}

export const getTxHash = async (input: GetTxHashInput) => {
  const { chain, tx } = input
  const chainKind = getChainKind(chain)

  // Only load the resolver we actually need
  const handler = await getHashResolver(chainKind)

  return await handler(tx)
}
