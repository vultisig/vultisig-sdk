import { getChainKind } from '@vultisig/core-chain/ChainKind'
import {
  BlockaidSimulationSupportedChainKind,
  blockaidSimulationSupportedChains,
} from '@vultisig/core-chain/security/blockaid/simulationChains'
import { BlockaidTxSimulationInput } from '@vultisig/core-chain/security/blockaid/tx/simulation/resolver'
import { getKeysignChain } from '@vultisig/core-mpc/keysign/utils/getKeysignChain'
import { isOneOf } from '@vultisig/lib-utils/array/isOneOf'

import {
  BlockaidTxSimulationInputResolver,
  BlockaidTxSimulationInputResolverInput,
} from './resolver'
import { getEvmBlockaidTxSimulationInput } from './resolvers/evm'
import { getSolanaBlockaidTxSimulationInput } from './resolvers/solana'

const resolvers: Record<
  BlockaidSimulationSupportedChainKind,
  BlockaidTxSimulationInputResolver<any>
> = {
  solana: getSolanaBlockaidTxSimulationInput,
  evm: getEvmBlockaidTxSimulationInput,
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
