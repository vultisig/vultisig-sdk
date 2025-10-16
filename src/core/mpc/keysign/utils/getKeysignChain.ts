import { KeysignPayload } from '../../types/vultisig/keysign/v1/keysign_message_pb'
import { Chain } from '../../../chain/Chain'

import { getKeysignCoin } from './getKeysignCoin'

// Normalize chain names to match the Chain enum values
const normalizeChainName = (chain: string): Chain => {
  // Common normalizations - handle case variations
  const normalized = chain.charAt(0).toUpperCase() + chain.slice(1).toLowerCase()

  // Special cases
  const chainMapping: Record<string, Chain> = {
    'ethereum': 'Ethereum' as Chain,
    'Ethereum': 'Ethereum' as Chain,
    'bitcoin': 'Bitcoin' as Chain,
    'Bitcoin': 'Bitcoin' as Chain,
    'bsc': 'BSC' as Chain,
    'BSC': 'BSC' as Chain,
    'avalanche': 'Avalanche' as Chain,
    'Avalanche': 'Avalanche' as Chain,
    // Add more mappings as needed
  }

  return (chainMapping[chain] || normalized) as Chain
}

export const getKeysignChain = (input: KeysignPayload) => {
  const coin = getKeysignCoin(input)
  return normalizeChainName(coin.chain)
}
