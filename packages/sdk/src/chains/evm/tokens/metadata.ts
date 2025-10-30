/**
 * EVM token metadata utilities
 *
 * Functions for fetching and managing token metadata
 */

import { EvmChain } from '@core/chain/Chain'
import { getEvmClient } from '@core/chain/chains/evm/client'
import { EvmToken } from '../types'
import { NATIVE_TOKEN_ADDRESS, isNativeToken, getChainId, ERC20_ABI } from '../config'

/**
 * Get ERC-20 token metadata
 *
 * Fetches name, symbol, and decimals from the blockchain.
 *
 * @param chain - EVM chain
 * @param tokenAddress - ERC-20 contract address
 * @returns Token metadata
 */
export async function getTokenMetadata(
  chain: EvmChain,
  tokenAddress: string
): Promise<{
  name: string
  symbol: string
  decimals: number
}> {
  // Return native token metadata if applicable
  if (isNativeToken(tokenAddress)) {
    return getNativeTokenMetadata(chain)
  }

  const client = getEvmClient(chain)

  try {
    // Fetch all metadata in parallel
    const [name, symbol, decimals] = await Promise.all([
      client.readContract({
        address: tokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'name',
      }) as Promise<string>,
      client.readContract({
        address: tokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'symbol',
      }) as Promise<string>,
      client.readContract({
        address: tokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'decimals',
      }) as Promise<number>,
    ])

    return {
      name,
      symbol,
      decimals,
    }
  } catch (error) {
    throw new Error(
      `Failed to fetch token metadata for ${tokenAddress} on ${chain}: ${error}`
    )
  }
}

/**
 * Build a complete EvmToken object from address
 *
 * @param chain - EVM chain
 * @param tokenAddress - Token contract address
 * @returns Complete EvmToken object
 */
export async function buildToken(
  chain: EvmChain,
  tokenAddress: string
): Promise<EvmToken> {
  const metadata = await getTokenMetadata(chain, tokenAddress)
  const chainId = getChainId(chain)

  return {
    address: tokenAddress,
    name: metadata.name,
    symbol: metadata.symbol,
    decimals: metadata.decimals,
    chainId,
  }
}

/**
 * Get native token for a chain
 *
 * @param chain - EVM chain
 * @returns Native token object
 */
export function getNativeToken(chain: EvmChain): EvmToken {
  const metadata = getNativeTokenMetadata(chain)
  const chainId = getChainId(chain)

  return {
    address: NATIVE_TOKEN_ADDRESS,
    ...metadata,
    chainId,
  }
}

/**
 * Get native token metadata for a chain
 */
function getNativeTokenMetadata(chain: EvmChain): {
  name: string
  symbol: string
  decimals: number
} {
  const nativeTokens: Record<
    EvmChain,
    { name: string; symbol: string; decimals: number }
  > = {
    [EvmChain.Ethereum]: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    [EvmChain.Arbitrum]: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    [EvmChain.Base]: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    [EvmChain.Blast]: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    [EvmChain.Optimism]: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    [EvmChain.Zksync]: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    [EvmChain.Mantle]: { name: 'Mantle', symbol: 'MNT', decimals: 18 },
    [EvmChain.Polygon]: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
    [EvmChain.Avalanche]: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
    [EvmChain.BSC]: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    [EvmChain.CronosChain]: { name: 'Cronos', symbol: 'CRO', decimals: 18 },
  }

  return nativeTokens[chain]
}

/**
 * Batch fetch token metadata for multiple tokens
 *
 * @param chain - EVM chain
 * @param tokenAddresses - Array of token addresses
 * @returns Array of token metadata (in same order as input)
 */
export async function batchGetTokenMetadata(
  chain: EvmChain,
  tokenAddresses: string[]
): Promise<EvmToken[]> {
  const promises = tokenAddresses.map((address) => buildToken(chain, address))
  return Promise.all(promises)
}

/**
 * Check if a token address is valid
 *
 * @param address - Token address to validate
 * @returns True if valid Ethereum address
 */
export function isValidTokenAddress(address: string): boolean {
  // Check if it's a valid hex string with 0x prefix
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return false
  }
  return true
}

/**
 * Normalize token address to checksum format
 *
 * @param address - Token address
 * @returns Checksummed address
 */
export function normalizeTokenAddress(address: string): string {
  // Simple lowercase normalization
  // For full checksum, would need to implement EIP-55
  return address.toLowerCase()
}
