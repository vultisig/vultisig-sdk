import { Chain } from '@core/chain/Chain'

import { SUPPORTED_CHAINS } from '../constants'

const validChainSet = new Set<string>(SUPPORTED_CHAINS)

export function assertValidChain(chain: string): asserts chain is Chain {
  if (validChainSet.has(chain)) return

  const keyMatch = Object.entries(Chain).find(([key]) => key === chain)
  if (keyMatch) {
    throw new Error(`Invalid chain: "${chain}". Use Chain.${keyMatch[0]} ("${keyMatch[1]}") instead.`)
  }

  throw new Error(`Unknown chain: "${chain}". Available: [${SUPPORTED_CHAINS.join(', ')}]`)
}
