import { Chain } from '@vultisig/sdk'

/**
 * Common token definition for suggestions
 */
export type CommonToken = {
  symbol: string
  name: string
  contractAddress: string
  decimals: number
}

/**
 * Popular tokens by chain - suggestions for quick adding
 */
export const COMMON_TOKENS: Partial<Record<Chain, CommonToken[]>> = {
  [Chain.Ethereum]: [
    { symbol: 'USDC', name: 'USD Coin', contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
    { symbol: 'USDT', name: 'Tether USD', contractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
    {
      symbol: 'DAI',
      name: 'Dai Stablecoin',
      contractAddress: '0x6B175474E89094C44Da98b954EesDbB725fb8fAf',
      decimals: 18,
    },
    {
      symbol: 'WETH',
      name: 'Wrapped Ether',
      contractAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      decimals: 18,
    },
    {
      symbol: 'WBTC',
      name: 'Wrapped Bitcoin',
      contractAddress: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      decimals: 8,
    },
    { symbol: 'LINK', name: 'Chainlink', contractAddress: '0x514910771AF9Ca656af840dff83E8264EcF986CA', decimals: 18 },
  ],
  [Chain.Polygon]: [
    { symbol: 'USDC', name: 'USD Coin', contractAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
    { symbol: 'USDT', name: 'Tether USD', contractAddress: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
    {
      symbol: 'DAI',
      name: 'Dai Stablecoin',
      contractAddress: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
      decimals: 18,
    },
    {
      symbol: 'WMATIC',
      name: 'Wrapped MATIC',
      contractAddress: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
      decimals: 18,
    },
  ],
  [Chain.Arbitrum]: [
    { symbol: 'USDC', name: 'USD Coin', contractAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
    { symbol: 'USDT', name: 'Tether USD', contractAddress: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
    { symbol: 'ARB', name: 'Arbitrum', contractAddress: '0x912CE59144191C1204E64559FE8253a0e49E6548', decimals: 18 },
    {
      symbol: 'WETH',
      name: 'Wrapped Ether',
      contractAddress: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      decimals: 18,
    },
  ],
  [Chain.Base]: [
    { symbol: 'USDC', name: 'USD Coin', contractAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
    {
      symbol: 'WETH',
      name: 'Wrapped Ether',
      contractAddress: '0x4200000000000000000000000000000000000006',
      decimals: 18,
    },
  ],
  [Chain.Optimism]: [
    { symbol: 'USDC', name: 'USD Coin', contractAddress: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6 },
    { symbol: 'USDT', name: 'Tether USD', contractAddress: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6 },
    { symbol: 'OP', name: 'Optimism', contractAddress: '0x4200000000000000000000000000000000000042', decimals: 18 },
    {
      symbol: 'WETH',
      name: 'Wrapped Ether',
      contractAddress: '0x4200000000000000000000000000000000000006',
      decimals: 18,
    },
  ],
  [Chain.BSC]: [
    { symbol: 'USDT', name: 'Tether USD', contractAddress: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
    {
      symbol: 'BUSD',
      name: 'Binance USD',
      contractAddress: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
      decimals: 18,
    },
    {
      symbol: 'WBNB',
      name: 'Wrapped BNB',
      contractAddress: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
      decimals: 18,
    },
    { symbol: 'USDC', name: 'USD Coin', contractAddress: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
  ],
  [Chain.Avalanche]: [
    { symbol: 'USDC', name: 'USD Coin', contractAddress: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', decimals: 6 },
    { symbol: 'USDT', name: 'Tether USD', contractAddress: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', decimals: 6 },
    {
      symbol: 'WAVAX',
      name: 'Wrapped AVAX',
      contractAddress: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
      decimals: 18,
    },
  ],
}

/**
 * EVM chains that support ERC-20 style tokens
 */
export const EVM_CHAINS: Chain[] = [
  Chain.Ethereum,
  Chain.Polygon,
  Chain.Avalanche,
  Chain.BSC,
  Chain.Arbitrum,
  Chain.Optimism,
  Chain.Base,
]

/**
 * Check if a chain is an EVM chain (supports ERC-20 tokens)
 */
export function isEvmChain(chain: Chain): boolean {
  return EVM_CHAINS.includes(chain)
}

/**
 * Get common tokens for a chain
 */
export function getCommonTokens(chain: Chain): CommonToken[] {
  return COMMON_TOKENS[chain] || []
}
