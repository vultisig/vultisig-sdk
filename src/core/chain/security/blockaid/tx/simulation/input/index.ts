import { getChainKind } from '../../../../../ChainKind'
import {
  BlockaidSimulationSupportedChainKind,
  blockaidSimulationSupportedChains,
} from '../../../simulationChains'
import { getKeysignChain } from '../../../../../../mpc/keysign/utils/getKeysignChain'
import { isOneOf } from '../../../../../../../lib/utils/array/isOneOf'

import { BlockaidTxSimulationInput } from '../resolver'
import {
  BlockaidTxSimulationInputResolver,
  BlockaidTxSimulationInputResolverInput,
} from './resolver'
import { getSolanaBlockaidTxSimulationInput } from './resolvers/solana'

const resolvers: Record<
  BlockaidSimulationSupportedChainKind,
  BlockaidTxSimulationInputResolver<any>
> = {
  solana: getSolanaBlockaidTxSimulationInput,
}

export const getBlockaidTxSimulationInput = (
  input: Omit<BlockaidTxSimulationInputResolverInput, 'chain'>
): BlockaidTxSimulationInput | null => {
  const chain = getKeysignChain(input.payload)
  if (!isOneOf(chain, blockaidSimulationSupportedChains)) {
    return null
  }

  const chainKind = getChainKind(chain)

  const data = resolvers[chainKind]({
    ...input,
    chain,
  })

  if (!data) {
    return null
  }

  return { chain, data }
}
