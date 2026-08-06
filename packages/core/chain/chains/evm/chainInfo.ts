import { EvmChain } from '@vultisig/core-chain/Chain'
import { getCustomRpcOverride } from '@vultisig/core-chain/chains/customRpc/customRpcOverrides'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { rootApiUrl } from '@vultisig/core-config'
import { numberToHex } from '@vultisig/lib-utils/hex/numberToHex'
import { mirrorRecord } from '@vultisig/lib-utils/record/mirrorRecord'
import { recordMap } from '@vultisig/lib-utils/record/recordMap'
import { Chain as ViemChain, defineChain } from 'viem'
import {
  arbitrum,
  avalanche,
  base,
  blast,
  bsc,
  cronos,
  mainnet,
  mantle,
  optimism,
  polygon,
  sei,
  zksync,
} from 'viem/chains'

const hyperliquidRpcUrl = `${rootApiUrl}/hyperevm/`
// HyperEVM transactions and addresses live under hypurrscan's `/evm/` section.
// The bare `https://hypurrscan.io/tx/<hash>` path returns a server error.
export const hyperliquidBlockExplorerUrl = 'https://hypurrscan.io/evm'
const hyperliquidNativeCoin = chainFeeCoin[EvmChain.Hyperliquid]

export const hyperliquid = defineChain({
  id: 999,
  name: 'Hyperliquid',
  network: 'hyperliquid',
  nativeCurrency: {
    name: 'Hyperliquid',
    symbol: hyperliquidNativeCoin.ticker,
    decimals: hyperliquidNativeCoin.decimals,
  },
  rpcUrls: {
    default: { http: [hyperliquidRpcUrl] },
    public: { http: [hyperliquidRpcUrl] },
  },
  blockExplorers: {
    default: { name: 'Hypurrscan', url: hyperliquidBlockExplorerUrl },
  },
})

const robinhoodRpcUrl = 'https://rpc.mainnet.chain.robinhood.com'
export const robinhoodBlockExplorerUrl = 'https://robinhoodchain.blockscout.com'
const robinhoodNativeCoin = chainFeeCoin[EvmChain.Robinhood]

export const robinhood = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  network: 'robinhood',
  nativeCurrency: {
    name: 'Ether',
    symbol: robinhoodNativeCoin.ticker,
    decimals: robinhoodNativeCoin.decimals,
  },
  rpcUrls: {
    default: { http: [robinhoodRpcUrl] },
    public: { http: [robinhoodRpcUrl] },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: robinhoodBlockExplorerUrl },
  },
})

const evmChainRpcUrls: Record<EvmChain, string> = {
  [EvmChain.Ethereum]: `${rootApiUrl}/eth/`,
  [EvmChain.Base]: `${rootApiUrl}/base/`,
  [EvmChain.Arbitrum]: `${rootApiUrl}/arb/`,
  [EvmChain.Polygon]: `${rootApiUrl}/polygon/`,
  [EvmChain.Optimism]: `${rootApiUrl}/opt/`,
  [EvmChain.CronosChain]: 'https://cronos-evm-rpc.publicnode.com',
  [EvmChain.Blast]: `${rootApiUrl}/blast/`,
  [EvmChain.BSC]: `${rootApiUrl}/bsc/`,
  [EvmChain.Zksync]: `${rootApiUrl}/zksync/`,
  [EvmChain.Avalanche]: `${rootApiUrl}/avax/`,
  [EvmChain.Mantle]: `${rootApiUrl}/mantle/`,
  [EvmChain.Hyperliquid]: hyperliquidRpcUrl,
  [EvmChain.Sei]: `https://evm-rpc.sei-apis.com`,
  [EvmChain.Robinhood]: robinhoodRpcUrl,
}

const evmDefaultChainInfo: Record<EvmChain, ViemChain> = {
  [EvmChain.Ethereum]: mainnet,
  [EvmChain.Base]: base,
  [EvmChain.Arbitrum]: arbitrum,
  [EvmChain.Polygon]: polygon,
  [EvmChain.Optimism]: optimism,
  [EvmChain.CronosChain]: cronos,
  [EvmChain.Blast]: blast,
  [EvmChain.BSC]: bsc,
  [EvmChain.Zksync]: zksync,
  [EvmChain.Avalanche]: avalanche,
  [EvmChain.Mantle]: mantle,
  [EvmChain.Hyperliquid]: hyperliquid,
  [EvmChain.Sei]: sei,
  [EvmChain.Robinhood]: robinhood,
}

const evmChainId: Record<EvmChain, string> = recordMap(evmDefaultChainInfo, chain => numberToHex(chain.id))

export const evmChainInfo = recordMap(evmDefaultChainInfo, (chain, chainKey) => {
  const rpcUrl = evmChainRpcUrls[chainKey]

  return {
    ...chain,
    rpcUrls: {
      ...chain.rpcUrls,
      default: { http: [rpcUrl] },
    },
  }
})

/**
 * Resolves the RPC URL for an EVM chain, honoring an app-wide custom RPC
 * override when one is set and falling back to the default endpoint otherwise.
 * Byte-identical to the default when no override is configured.
 */
export const getEvmRpcUrl = (chain: EvmChain): string => getCustomRpcOverride(chain) ?? evmChainRpcUrls[chain]

export const getEvmChainId = (chain: EvmChain): string => {
  return evmChainId[chain]
}

export const getEvmChainByChainId = (chainId: string): EvmChain | undefined => {
  return mirrorRecord(evmChainId)[chainId]
}
