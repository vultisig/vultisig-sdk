/**
 * Uniswap V2 deployment addresses on Vultisig-supported EVM chains.
 *
 * Source of truth:
 *   https://developers.uniswap.org/docs/protocols/v2/deployments
 *
 * Ported from mcp-ts `src/tools/uniswap/addresses.ts`. Read-only metadata:
 * V2 swaps require ERC-20 approval, deadline/slippage choices, and Router02
 * calldata money-testing before any direct signer surface is exposed.
 */
import { EvmChain } from '@vultisig/core-chain/Chain'
import { getAddress } from 'viem'

export type UniV2Deployment = {
  chainId: number
  factory: `0x${string}`
  router02: `0x${string}`
  wrappedNative: `0x${string}`
}

export const UNI_V2_DEPLOYMENTS: Partial<Record<EvmChain, UniV2Deployment>> = {
  [EvmChain.Ethereum]: {
    chainId: 1,
    factory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    router02: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    wrappedNative: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  },
  [EvmChain.Arbitrum]: {
    chainId: 42161,
    factory: '0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9',
    router02: '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
    wrappedNative: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  },
  [EvmChain.Avalanche]: {
    chainId: 43114,
    factory: '0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C',
    router02: '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
    wrappedNative: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
  },
  [EvmChain.BSC]: {
    chainId: 56,
    factory: '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6',
    router02: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24',
    wrappedNative: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  },
  [EvmChain.Base]: {
    chainId: 8453,
    factory: '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6',
    router02: '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
    wrappedNative: '0x4200000000000000000000000000000000000006',
  },
  [EvmChain.Optimism]: {
    chainId: 10,
    factory: '0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf',
    router02: '0x4A7b5Da61326A6379179b40d00F57E5bbDC962c2',
    wrappedNative: '0x4200000000000000000000000000000000000006',
  },
  [EvmChain.Polygon]: {
    chainId: 137,
    factory: '0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C',
    router02: '0xedf6066a2b290C185783862C7F4776A2C8077AD1',
    wrappedNative: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  },
}

export function supportedUniV2Chains(): EvmChain[] {
  return Object.keys(UNI_V2_DEPLOYMENTS) as EvmChain[]
}

/**
 * Resolve a token reference: `native` maps to the chain's wrapped native
 * token, anything else is returned as a checksummed address.
 */
export function resolveUniV2Token(addr: string, chain: EvmChain): string {
  const deployment = UNI_V2_DEPLOYMENTS[chain]
  if (addr.trim().toLowerCase() === 'native' && deployment) {
    return deployment.wrappedNative
  }
  return addr.trim()
}

export { getAddress }
