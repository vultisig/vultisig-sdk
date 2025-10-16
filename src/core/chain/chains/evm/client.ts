import { createPublicClient, http, PublicClient } from 'viem'

import { memoize } from '../../../../lib/utils/memoize'
import { EvmChain } from '../../Chain'
import { evmChainInfo } from './chainInfo'

export const getEvmClient = memoize(
  (chain: EvmChain, customRpcUrl?: string): PublicClient => {
    const chainInfo = evmChainInfo[chain]

    // Use custom RPC URL if provided, otherwise use default
    const rpcUrl = customRpcUrl || chainInfo.rpcUrls.default.http[0]

    return createPublicClient({
      chain: {
        id: chainInfo.id,
        name: chainInfo.name,
        nativeCurrency: chainInfo.nativeCurrency,
        rpcUrls: {
          default: { http: [rpcUrl] },
        },
        blockExplorers: chainInfo.blockExplorers,
      },
      transport: http(),
    })
  }
)
