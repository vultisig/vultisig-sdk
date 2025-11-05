import { Chain } from '@core/chain/Chain'
import { getChainKind } from '@core/chain/ChainKind'
import { GasInfo } from '../../types'

/**
 * Convert core FeeQuote to SDK GasInfo format
 *
 * This adapter bridges between core's chain-specific fee quote structures
 * and SDK's unified GasInfo type.
 *
 * Different chain types have different fee structures:
 * - EVM: Complex (gasPrice, maxFeePerGas, priorityFee, gasPriceGwei)
 * - UTXO: Simple (fee per byte)
 * - Cosmos: Simple (gas price)
 * - Others: Chain-specific
 *
 * @param feeQuote Fee quote from core (structure varies by chain)
 * @param chain Chain identifier
 * @returns Formatted GasInfo object
 */
export function formatGasInfo(feeQuote: any, chain: string): GasInfo {
  const chainType = getChainKind(chain as Chain)

  // EVM chains have complex gas structure (EIP-1559)
  if (chainType === 'evm') {
    return {
      chainId: chain,
      gasPrice: feeQuote.gasPrice?.toString() ?? '0',
      gasPriceGwei: feeQuote.gasPriceGwei?.toString(),
      maxFeePerGas: feeQuote.maxFeePerGas?.toString(),
      priorityFee: feeQuote.priorityFee?.toString(),
      lastUpdated: Date.now()
    }
  }

  // Other chains - simpler structure
  // feeQuote is typically a bigint representing the fee
  return {
    chainId: chain,
    gasPrice: typeof feeQuote === 'bigint' ? feeQuote.toString() : String(feeQuote),
    lastUpdated: Date.now()
  }
}
