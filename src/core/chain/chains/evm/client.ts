import { EvmChain } from '../../Chain'
import { memoize } from '../../../../lib/utils/memoize'
import { createPublicClient, http, PublicClient } from 'viem'

import { evmChainInfo } from './chainInfo'

export const getEvmClient = memoize((chain: EvmChain): PublicClient => {
  return createPublicClient({
    chain: evmChainInfo[chain],
    transport: http(),
  })
})
