import { Chain, EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import { getAddress } from 'viem'
import { normalize } from 'viem/ens'

import { NameServiceResolver } from '../resolver'

/**
 * ENS names (`.eth`, subdomains such as `pay.vitalik.eth` included), resolved
 * on Ethereum mainnet to their Ethereum address. ENSIP-11 records for other
 * chains are not read, so a name is only sent to on Ethereum.
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
