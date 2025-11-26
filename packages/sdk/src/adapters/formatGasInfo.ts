import type { Chain } from '@core/chain/Chain'
import { KeysignChainSpecific } from '@core/mpc/keysign/chainSpecific/KeysignChainSpecific'

import { GasInfo } from '../types'

/**
 * Convert core KeysignChainSpecific to SDK GasInfo format
 *
 * This adapter bridges between core's chain-specific blockchain data
 * (from KeysignPayload) and SDK's unified GasInfo type.
 *
 * Different chain types have different fee structures:
 * - EVM: maxFeePerGasWei, priorityFee, gasLimit (EIP-1559)
 * - UTXO: byteFee (satoshis per byte)
 * - Cosmos: gas
 * - Others: Chain-specific
 *
 * @param chainSpecific Chain-specific data from keysign payload
 * @param chain Chain identifier
 * @returns Formatted GasInfo object with proper type conversions
 */
export function formatGasInfo(chainSpecific: KeysignChainSpecific, chain: Chain): GasInfo {
  // EVM chains (EIP-1559 gas structure)
  if (chainSpecific.case === 'ethereumSpecific') {
    const { maxFeePerGasWei, priorityFee, gasLimit } = chainSpecific.value

    // Convert strings from protobuf to bigints
    const maxFeePerGasBigInt = BigInt(maxFeePerGasWei)
    const priorityFeeBigInt = BigInt(priorityFee)
    const gasLimitBigInt = BigInt(gasLimit)

    // Convert Wei to Gwei for display (divide by 1e9)
    const maxFeePerGasGwei = maxFeePerGasBigInt / BigInt(1e9)

    // Calculate estimated cost: gasLimit * maxFeePerGas
    const estimatedCost = gasLimitBigInt * maxFeePerGasBigInt

    return {
      chainId: chain,
      gasPrice: maxFeePerGasWei, // Keep as string for compatibility
      gasPriceGwei: maxFeePerGasGwei.toString(), // in Gwei
      maxFeePerGas: maxFeePerGasBigInt,
      maxPriorityFeePerGas: priorityFeeBigInt,
      priorityFee: priorityFee, // Keep as string for compatibility
      gasLimit: gasLimitBigInt,
      estimatedCost: estimatedCost,
      lastUpdated: Date.now(),
    }
  }

  // UTXO chains (byte fee)
  if (chainSpecific.case === 'utxoSpecific') {
    const { byteFee } = chainSpecific.value
    const byteFeeBigInt = BigInt(byteFee)

    // Estimate transaction size (typical: 2 inputs + 2 outputs ≈ 400 bytes)
    // This is a rough estimate; actual size varies based on UTXO selection
    const estimatedTxSize = 400n
    const estimatedCost = byteFeeBigInt * estimatedTxSize

    return {
      chainId: chain,
      gasPrice: byteFee,
      byteFee,
      estimatedCost,
      lastUpdated: Date.now(),
    }
  }

  // Cosmos chains (gas)
  if (chainSpecific.case === 'cosmosSpecific') {
    const { gas } = chainSpecific.value
    const gasBigInt = BigInt(gas)

    return {
      chainId: chain,
      gasPrice: gas.toString(),
      gas: gas.toString(),
      estimatedCost: gasBigInt,
      lastUpdated: Date.now(),
    }
  }

  // THORChain
  if (chainSpecific.case === 'thorchainSpecific') {
    const { fee } = chainSpecific.value

    return {
      chainId: chain,
      gasPrice: fee.toString(),
      estimatedCost: fee,
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
    const priorityFeeBigInt = BigInt(priorityFee)

    // Solana: base fee (5000 lamports) + priority fee
    const baseFee = 5000n
    const estimatedCost = baseFee + priorityFeeBigInt

    return {
      chainId: chain,
      gasPrice: priorityFee,
      priorityFee: priorityFee,
      estimatedCost,
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
