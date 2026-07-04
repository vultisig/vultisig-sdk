/**
 * Uniswap V3 deployment addresses on Vultisig-supported EVM chains.
 *
 * Source of truth:
 *   https://github.com/Uniswap/docs/tree/main/docs/contracts/v3/reference/deployments
 *
 * Read-only metadata only — these power pool-info / tick-math lookups. No
 * swap calldata is built here; V3 swaps require ERC-20 approval, slippage and
 * deadline choices that belong to a dedicated signer surface.
 *
 * Ported from vultisig/mcp-ts `src/tools/uniswap/addresses.ts`.
 */
import type { EvmChain } from '../../../types'

export const UNI_V3_FACTORY: Partial<Record<EvmChain, `0x${string}`>> = {
  Ethereum: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  Arbitrum: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  Optimism: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  Polygon: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  Base: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
  BSC: '0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7',
  Avalanche: '0x740b1c1de25031C31FF4fC9A62f554A55cdC1baD',
  Blast: '0x792edAdE80af5fC680d96a2eD80A44247D2Cf6Fd',
}

const UNI_V3_WRAPPED_NATIVE: Partial<Record<EvmChain, `0x${string}`>> = {
  Ethereum: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  Arbitrum: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  Optimism: '0x4200000000000000000000000000000000000006',
  Base: '0x4200000000000000000000000000000000000006',
  Polygon: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  BSC: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  Avalanche: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
  Blast: '0x4300000000000000000000000000000000000004',
}

/** Chains where Uniswap V3 pool-info lookups are supported, sorted. */
export function supportedUniV3Chains(): EvmChain[] {
  return (Object.keys(UNI_V3_FACTORY) as EvmChain[]).sort()
}

/**
 * Resolve the `native` sentinel to the chain's wrapped-native token address.
 * Any other value passes through unchanged.
 */
export function resolveNativeToken(addr: string, chain: EvmChain): string {
  if (addr.toLowerCase() === 'native') {
    const w = UNI_V3_WRAPPED_NATIVE[chain]
    if (w) return w
  }
  return addr
}
