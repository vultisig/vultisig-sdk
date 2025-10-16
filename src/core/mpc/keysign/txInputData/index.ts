import { ChainKind, getChainKind } from '../../../chain/ChainKind'
import { KeysignPayload } from '../../types/vultisig/keysign/v1/keysign_message_pb'
import { WalletCore } from '@trustwallet/wallet-core'
import { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'

import { getKeysignChain } from '../utils/getKeysignChain'
import { TxInputDataResolver } from './resolver'

type Input = {
  keysignPayload: KeysignPayload
  walletCore: WalletCore
  publicKey?: PublicKey
}

/**
 * Dynamically loads the appropriate tx input data resolver for the given chain
 * This approach reduces bundle size and avoids loading unused code
 */
async function getTxInputDataResolver(chainKind: ChainKind): Promise<TxInputDataResolver<any>> {
  switch (chainKind) {
    case 'cardano':
      return (await import('./resolvers/cardano')).getCardanoTxInputData
    case 'cosmos':
      return (await import('./resolvers/cosmos')).getCosmosTxInputData
    case 'evm':
      return (await import('./resolvers/evm')).getEvmTxInputData
    case 'polkadot':
      return (await import('./resolvers/polkadot')).getPolkadotTxInputData
    case 'ripple':
      return (await import('./resolvers/ripple')).getRippleTxInputData
    case 'solana':
      return (await import('./resolvers/solana')).getSolanaTxInputData
    case 'sui':
      return (await import('./resolvers/sui')).getSuiTxInputData
    case 'ton':
      return (await import('./resolvers/ton')).getTonTxInputData
    case 'tron':
      return (await import('./resolvers/tron')).getTronTxInputData
    case 'utxo':
      return (await import('./resolvers/utxo')).getUtxoTxInputData
    default:
      throw new Error(`Unsupported chain kind: ${chainKind}`)
  }
}

export const getTxInputData = async (input: Input) => {
  const { blockchainSpecific } = input.keysignPayload
  if (!blockchainSpecific.case) {
    throw new Error('Invalid blockchain specific')
  }

  const chain = getKeysignChain(input.keysignPayload)
  const chainKind = getChainKind(chain)

  if (!chainKind) {
    throw new Error(`Unable to determine chain kind for chain: ${chain}`)
  }

  // Only load the resolver we actually need
  const resolver = await getTxInputDataResolver(chainKind)

  return resolver({
    ...input,
    chain,
  })
}
