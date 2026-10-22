import { Chain, EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import { getAddress } from 'viem'
import { normalize } from 'viem/ens'

import { NameServiceResolver } from '../resolver'

/**
 * ENS names (`.eth`), resolved to their Ethereum mainnet address. Only root
 * `.eth` names on Ethereum: ENSIP-11 multi-chain coin types and offchain
 * (CCIP-Read) resolvers are not supported.
 */
export const ensResolver: NameServiceResolver = {
  isChainSupported: chain => chain === Chain.Ethereum,
  resolve: async ({ name }) => {
    let normalizedName: string
    try {
      normalizedName = normalize(name)
    } catch {
      // ENS cannot hold this name, so nothing is registered under it.
      return { kind: 'notFound' }
    }

    const address = await getEvmClient(EvmChain.Ethereum).getEnsAddress({ name: normalizedName })

    return address ? { kind: 'resolved', address: getAddress(address) } : { kind: 'notFound' }
  },
}
