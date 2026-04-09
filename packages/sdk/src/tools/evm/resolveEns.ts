import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import { normalize } from 'viem/ens'

/**
 * Resolve an ENS name to an Ethereum address.
 *
 * @example
 * ```ts
 * const address = await resolveEns('vitalik.eth')
 * // => '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
 * ```
 */
export const resolveEns = async (name: string): Promise<`0x${string}` | null> => {
  const client = getEvmClient('Ethereum')

  return client.getEnsAddress({ name: normalize(name) })
}
