import { EvmChain } from '@vultisig/core-chain/Chain'

export const cowSwapSupportedChains = [EvmChain.Ethereum, EvmChain.Arbitrum, EvmChain.Base, EvmChain.Avalanche] as const

export type CowSwapSupportedChain = (typeof cowSwapSupportedChains)[number]

// CowSwap GPv2 contract addresses — same across all supported EVM chains.
export const COW_SETTLEMENT_ADDRESS = '0x9008D19f58AAbD9eD0D60971565AA8510560ab41'
export const COW_VAULT_RELAYER_ADDRESS = '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110'

export type CowSwapChainConfig = {
  apiBase: string
  settlementContract: string
  vaultRelayer: string
  chainId: number
}

export const cowSwapChainConfig: Record<CowSwapSupportedChain, CowSwapChainConfig> = {
  [EvmChain.Ethereum]: {
    apiBase: 'https://api.cow.fi/mainnet',
    settlementContract: COW_SETTLEMENT_ADDRESS,
    vaultRelayer: COW_VAULT_RELAYER_ADDRESS,
    chainId: 1,
  },
  [EvmChain.Arbitrum]: {
    apiBase: 'https://api.cow.fi/arbitrum_one',
    settlementContract: COW_SETTLEMENT_ADDRESS,
    vaultRelayer: COW_VAULT_RELAYER_ADDRESS,
    chainId: 42161,
  },
  [EvmChain.Base]: {
    apiBase: 'https://api.cow.fi/base',
    settlementContract: COW_SETTLEMENT_ADDRESS,
    vaultRelayer: COW_VAULT_RELAYER_ADDRESS,
    chainId: 8453,
  },
  [EvmChain.Avalanche]: {
    apiBase: 'https://api.cow.fi/avalanche',
    settlementContract: COW_SETTLEMENT_ADDRESS,
    vaultRelayer: COW_VAULT_RELAYER_ADDRESS,
    chainId: 43114,
  },
}

// Static allowlist of EIP-2612 permit-supporting tokens per chain.
// Tradeoff: an RPC-probe approach would be fully dynamic but requires an extra
// call per token per quote. Static list covers the vast majority of common
// pairs (USDC/DAI/USDT on all v1 chains) at zero overhead. Track additions
// as a follow-up when new permit tokens need support.
export const KNOWN_PERMIT_TOKENS: Record<number, string[]> = {
  // Ethereum
  1: [
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
    '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
  ],
  // Arbitrum
  42161: [
    '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', // USDC.e
    '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC native
    '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // USDT
    '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', // DAI
  ],
  // Base
  8453: [
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
    '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', // DAI
  ],
  // Avalanche
  43114: [
    '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', // USDC
    '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', // USDT
    '0xd586E7F844cEa2F87f50152665BCbc2C279D8d70', // DAI.e
  ],
}

export const COWSWAP_APP_CODE = 'vultisig'
export const COWSWAP_APP_VERSION = '0.1.0'

// CowSwap partner fee BPS for affiliate revenue.
// Phase 2 (mcp-ts) will wire the consumer-level affiliateBps through.
// Phase 1 uses a fixed default matching the vultisig-0 baseline.
export const COWSWAP_DEFAULT_AFFILIATE_BPS = 50

// Vultisig fee recipient address for CowSwap partner fees.
export const COWSWAP_FEE_RECIPIENT = '0x8E247a480449c84a5fDD25974A8501f3EFa4ABb9'

// Order validity window in seconds (15 minutes).
export const COWSWAP_VALID_TO_SECONDS = 15 * 60
