/**
 * EVM chain configuration and constants
 *
 * Contains chain IDs, common contract addresses, and protocol identifiers
 * for all supported EVM-compatible chains.
 */

import { EvmChain } from '@core/chain/Chain'
import { EvmToken } from './types'

/**
 * EVM chain ID mappings
 * Maps chain enum to numeric chain ID
 */
export const EVM_CHAIN_IDS: Record<EvmChain, number> = {
  [EvmChain.Ethereum]: 1,
  [EvmChain.Arbitrum]: 42161,
  [EvmChain.Base]: 8453,
  [EvmChain.Blast]: 81457,
  [EvmChain.Optimism]: 10,
  [EvmChain.Zksync]: 324,
  [EvmChain.Mantle]: 5000,
  [EvmChain.Avalanche]: 43114,
  [EvmChain.CronosChain]: 25,
  [EvmChain.BSC]: 56,
  [EvmChain.Polygon]: 137,
}

/**
 * Native token address constant
 * Used to represent native tokens (ETH, MATIC, BNB, etc.)
 */
export const NATIVE_TOKEN_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

/**
 * Common ERC-20 token addresses by chain
 */
export const COMMON_TOKENS: Record<
  EvmChain,
  Record<string, Omit<EvmToken, 'chainId'>>
> = {
  [EvmChain.Ethereum]: {
    WETH: {
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      name: 'Wrapped Ether',
      symbol: 'WETH',
      decimals: 18,
    },
    USDC: {
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
    },
    USDT: {
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      name: 'Tether USD',
      symbol: 'USDT',
      decimals: 6,
    },
    DAI: {
      address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      name: 'Dai Stablecoin',
      symbol: 'DAI',
      decimals: 18,
    },
  },
  [EvmChain.Arbitrum]: {
    WETH: {
      address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      name: 'Wrapped Ether',
      symbol: 'WETH',
      decimals: 18,
    },
    USDC: {
      address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
    },
    USDT: {
      address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
      name: 'Tether USD',
      symbol: 'USDT',
      decimals: 6,
    },
  },
  [EvmChain.Base]: {
    WETH: {
      address: '0x4200000000000000000000000000000000000006',
      name: 'Wrapped Ether',
      symbol: 'WETH',
      decimals: 18,
    },
    USDC: {
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
    },
  },
  [EvmChain.Optimism]: {
    WETH: {
      address: '0x4200000000000000000000000000000000000006',
      name: 'Wrapped Ether',
      symbol: 'WETH',
      decimals: 18,
    },
    USDC: {
      address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
    },
    USDT: {
      address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
      name: 'Tether USD',
      symbol: 'USDT',
      decimals: 6,
    },
  },
  [EvmChain.Polygon]: {
    WETH: {
      address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
      name: 'Wrapped Ether',
      symbol: 'WETH',
      decimals: 18,
    },
    WMATIC: {
      address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
      name: 'Wrapped Matic',
      symbol: 'WMATIC',
      decimals: 18,
    },
    USDC: {
      address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
    },
    USDT: {
      address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
      name: 'Tether USD',
      symbol: 'USDT',
      decimals: 6,
    },
  },
  [EvmChain.BSC]: {
    WBNB: {
      address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
      name: 'Wrapped BNB',
      symbol: 'WBNB',
      decimals: 18,
    },
    USDC: {
      address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 18,
    },
    USDT: {
      address: '0x55d398326f99059fF775485246999027B3197955',
      name: 'Tether USD',
      symbol: 'USDT',
      decimals: 18,
    },
  },
  [EvmChain.Avalanche]: {
    WAVAX: {
      address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
      name: 'Wrapped AVAX',
      symbol: 'WAVAX',
      decimals: 18,
    },
    USDC: {
      address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
    },
    USDT: {
      address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
      name: 'Tether USD',
      symbol: 'USDT',
      decimals: 6,
    },
  },
  [EvmChain.Blast]: {},
  [EvmChain.Zksync]: {},
  [EvmChain.Mantle]: {},
  [EvmChain.CronosChain]: {},
}

/**
 * Common DEX router addresses
 */
export const DEX_ROUTERS = {
  // Uniswap V2
  UNISWAP_V2_ROUTER: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
  // Uniswap V3
  UNISWAP_V3_ROUTER: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  UNISWAP_V3_ROUTER_2: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
  // 1inch
  ONEINCH_V5_ROUTER: '0x1111111254EEB25477B68fb85Ed929f73A960582',
  ONEINCH_V6_ROUTER: '0x111111125421cA6dc452d289314280a0f8842A65',
} as const

/**
 * ERC-20 function selectors
 */
export const ERC20_SELECTORS = {
  TRANSFER: '0xa9059cbb',              // transfer(address,uint256)
  TRANSFER_FROM: '0x23b872dd',         // transferFrom(address,address,uint256)
  APPROVE: '0x095ea7b3',               // approve(address,uint256)
  BALANCE_OF: '0x70a08231',            // balanceOf(address)
  ALLOWANCE: '0xdd62ed3e',             // allowance(address,address)
} as const

/**
 * ERC-721 function selectors
 */
export const ERC721_SELECTORS = {
  TRANSFER_FROM: '0x23b872dd',         // transferFrom(address,address,uint256)
  SAFE_TRANSFER_FROM: '0x42842e0e',    // safeTransferFrom(address,address,uint256)
  SAFE_TRANSFER_FROM_DATA: '0xb88d4fde', // safeTransferFrom(address,address,uint256,bytes)
} as const

/**
 * ERC-1155 function selectors
 */
export const ERC1155_SELECTORS = {
  SAFE_TRANSFER_FROM: '0xf242432a',    // safeTransferFrom(address,address,uint256,uint256,bytes)
  SAFE_BATCH_TRANSFER: '0x2eb2c2d6',   // safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)
} as const

/**
 * Standard ERC-20 ABI fragments
 */
export const ERC20_ABI = [
  {
    constant: true,
    inputs: [],
    name: 'name',
    outputs: [{ name: '', type: 'string' }],
    type: 'function',
  },
  {
    constant: true,
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', type: 'string' }],
    type: 'function',
  },
  {
    constant: true,
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    type: 'function',
  },
  {
    constant: true,
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    type: 'function',
  },
  {
    constant: true,
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    type: 'function',
  },
] as const

/**
 * Helper functions
 */

/**
 * Get chain ID from chain enum
 */
export function getChainId(chain: EvmChain): number {
  return EVM_CHAIN_IDS[chain]
}

/**
 * Get chain enum from chain ID
 */
export function getChainFromId(chainId: number): EvmChain | undefined {
  return Object.entries(EVM_CHAIN_IDS).find(
    ([_, id]) => id === chainId
  )?.[0] as EvmChain | undefined
}

/**
 * Check if an address is the native token
 */
export function isNativeToken(address: string): boolean {
  return address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase()
}

/**
 * Check if a chain is an EVM chain
 */
export function isEvmChain(chain: string): chain is EvmChain {
  return chain in EVM_CHAIN_IDS
}

/**
 * Get common token by symbol for a chain
 */
export function getCommonToken(
  chain: EvmChain,
  symbol: string
): (EvmToken & { chainId: number }) | undefined {
  const token = COMMON_TOKENS[chain]?.[symbol]
  if (!token) return undefined

  return {
    ...token,
    chainId: EVM_CHAIN_IDS[chain],
  }
}
