import { Resolver } from '@vultisig/lib-utils/types/Resolver'

import { BlockaidSimulationSupportedChain, BlockaidSimulationSupportedChainKind } from '../../simulationChains'
import { BlockaidEVMSimulation, BlockaidSolanaSimulation, BlockaidSuiSimulation } from './api/core'

export type BlockaidTxSimulationInput<T extends BlockaidSimulationSupportedChain = BlockaidSimulationSupportedChain> = {
  chain: T
  data: Record<string, unknown>
}

type BlockaidSimulationByKind = {
  evm: BlockaidEVMSimulation
  solana: BlockaidSolanaSimulation
  sui: BlockaidSuiSimulation
}

export type BlockaidSimulationForChainKind<K extends BlockaidSimulationSupportedChainKind> = BlockaidSimulationByKind[K]

export type BlockaidTxSimulationResolver<
  T extends BlockaidSimulationSupportedChain = BlockaidSimulationSupportedChain,
  K extends BlockaidSimulationSupportedChainKind = BlockaidSimulationSupportedChainKind,
> = Resolver<BlockaidTxSimulationInput<T>, Promise<BlockaidSimulationForChainKind<K>>>
