import { EvmChain } from '@vultisig/core-chain/Chain'
import { memoize } from '@vultisig/lib-utils/memoize'
import { createPublicClient, http, PublicClient } from 'viem'

import { evmChainInfo, getEvmRpcUrl } from './chainInfo'

// Keyed on the resolved RPC URL (not just the chain) so toggling an app-wide
// custom RPC override yields a fresh client, while default users keep a single
// cached instance with byte-identical behaviour.
export const getEvmClient = memoize(
  (chain: EvmChain): PublicClient => {
    return createPublicClient({
      chain: evmChainInfo[chain],
      transport: http(getEvmRpcUrl(chain)),
    })
  },
  (chain: EvmChain) => `${chain}:${getEvmRpcUrl(chain)}`
)
