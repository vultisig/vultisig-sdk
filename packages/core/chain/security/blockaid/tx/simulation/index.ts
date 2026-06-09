import { Chain } from '@vultisig/core-chain/Chain'
import { DeriveChainKind, getChainKind } from '@vultisig/core-chain/ChainKind'

import { BlockaidSupportedEvmChain } from '../../evmChains'
import { BlockaidSimulationSupportedChain } from '../../simulationChains'
import { BlockaidSimulationForChainKind, BlockaidTxSimulationInput, BlockaidTxSimulationResolver } from './resolver'
import { getEvmTxBlockaidSimulation } from './resolvers/evm'
import { getSolanaTxBlockaidSimulation } from './resolvers/solana'
import { getSuiTxBlockaidSimulation } from './resolvers/sui'

type ResolverMap = {
  evm: BlockaidTxSimulationResolver<any, 'evm'>
  solana: BlockaidTxSimulationResolver<any, 'solana'>
  sui: BlockaidTxSimulationResolver<any, 'sui'>
}

const resolvers: ResolverMap = {
  solana: getSolanaTxBlockaidSimulation,
  evm: getEvmTxBlockaidSimulation,
  sui: getSuiTxBlockaidSimulation,
}

export function getTxBlockaidSimulation(
  input: BlockaidTxSimulationInput<BlockaidSupportedEvmChain>
): Promise<BlockaidSimulationForChainKind<'evm'>>

export function getTxBlockaidSimulation(
  input: BlockaidTxSimulationInput<typeof Chain.Solana>
): Promise<BlockaidSimulationForChainKind<'solana'>>

export function getTxBlockaidSimulation(
  input: BlockaidTxSimulationInput<typeof Chain.Sui>
): Promise<BlockaidSimulationForChainKind<'sui'>>

export async function getTxBlockaidSimulation<T extends BlockaidSimulationSupportedChain>(
  input: BlockaidTxSimulationInput<T>
): Promise<BlockaidSimulationForChainKind<DeriveChainKind<T>>> {
  const chainKind = getChainKind(input.chain)

  if (chainKind === 'solana') {
    return resolvers.solana(input) as Promise<BlockaidSimulationForChainKind<DeriveChainKind<T>>>
  }

  if (chainKind === 'sui') {
    return resolvers.sui(input) as Promise<BlockaidSimulationForChainKind<DeriveChainKind<T>>>
  }

  return resolvers.evm(input) as Promise<BlockaidSimulationForChainKind<DeriveChainKind<T>>>
}
