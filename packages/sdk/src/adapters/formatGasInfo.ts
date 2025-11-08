import { KeysignChainSpecific } from '@core/mpc/keysign/chainSpecific/KeysignChainSpecific'

import { GasInfo } from '../types'

/**
 * Convert core KeysignChainSpecific to SDK GasInfo format
 *
 * This adapter bridges between core's chain-specific blockchain data
 * (from KeysignPayload) and SDK's unified GasInfo type.
 *
 * Different chain types have different fee structures:
 * - EVM: maxFeePerGasWei, priorityFee (EIP-1559)
 * - UTXO: byteFee
 * - Cosmos: gas
 * - Others: Chain-specific
 *
 * @param chainSpecific Chain-specific data from keysign payload
 * @param chain Chain identifier
 * @returns Formatted GasInfo object
 */
export function formatGasInfo(
  chainSpecific: KeysignChainSpecific,
  chain: string
): GasInfo {
  // EVM chains (EIP-1559 gas structure)
  if (chainSpecific.case === 'ethereumSpecific') {
    const { maxFeePerGasWei, priorityFee } = chainSpecific.value

    // Convert Wei to Gwei for display (divide by 1e9)
    const maxFeePerGasGwei = BigInt(maxFeePerGasWei) / BigInt(1e9)

    return {
      chainId: chain,
      gasPrice: maxFeePerGasWei, // in Wei
      gasPriceGwei: maxFeePerGasGwei.toString(), // in Gwei
      maxFeePerGas: maxFeePerGasWei, // in Wei
      priorityFee: priorityFee, // in Wei
      lastUpdated: Date.now(),
    }
  }

  // UTXO chains (byte fee)
  if (chainSpecific.case === 'utxoSpecific') {
    const { byteFee } = chainSpecific.value
    return {
      chainId: chain,
      gasPrice: byteFee,
      lastUpdated: Date.now(),
    }
  }

  // Cosmos chains (gas)
  if (chainSpecific.case === 'cosmosSpecific') {
    const { gas } = chainSpecific.value
    return {
      chainId: chain,
      gasPrice: gas.toString(),
      lastUpdated: Date.now(),
    }
  }

  // THORChain
  if (chainSpecific.case === 'thorchainSpecific') {
    return {
      chainId: chain,
      gasPrice: '0', // THORChain doesn't use traditional gas
      lastUpdated: Date.now(),
    }
  }

  // Maya
  if (chainSpecific.case === 'mayaSpecific') {
    return {
      chainId: chain,
      gasPrice: '0', // Maya doesn't use traditional gas
      lastUpdated: Date.now(),
    }
  }

  // Solana
  if (chainSpecific.case === 'solanaSpecific') {
    const { priorityFee } = chainSpecific.value
    return {
      chainId: chain,
      gasPrice: priorityFee,
      priorityFee: priorityFee,
      lastUpdated: Date.now(),
    }
  }

  // Sui (note: case name is 'suicheSpecific' in protobuf)
  if (chainSpecific.case === 'suicheSpecific') {
    const { referenceGasPrice } = chainSpecific.value
    return {
      chainId: chain,
      gasPrice: referenceGasPrice.toString(),
      lastUpdated: Date.now(),
    }
  }

  // Polkadot
  if (chainSpecific.case === 'polkadotSpecific') {
    return {
      chainId: chain,
      gasPrice: '0', // Polkadot uses weight-based fees
      lastUpdated: Date.now(),
    }
  }

  // TON
  if (chainSpecific.case === 'tonSpecific') {
    return {
      chainId: chain,
      gasPrice: '0', // TON gas is calculated dynamically
      lastUpdated: Date.now(),
    }
  }

  // Tron
  if (chainSpecific.case === 'tronSpecific') {
    return {
      chainId: chain,
      gasPrice: '0', // Tron uses energy/bandwidth
      lastUpdated: Date.now(),
    }
  }

  // Ripple
  if (chainSpecific.case === 'rippleSpecific') {
    const { gas } = chainSpecific.value
    return {
      chainId: chain,
      gasPrice: gas.toString(),
      lastUpdated: Date.now(),
    }
  }

  // Cardano (note: case name is just 'cardano' in protobuf)
  if (chainSpecific.case === 'cardano') {
    return {
      chainId: chain,
      gasPrice: '0', // Cardano uses ADA-based fees
      lastUpdated: Date.now(),
    }
  }

  // Fallback for any unhandled chain types
  return {
    chainId: chain,
    gasPrice: '0',
    lastUpdated: Date.now(),
  }
}
