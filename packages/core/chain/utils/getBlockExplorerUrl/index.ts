import { Chain } from '@vultisig/core-chain/Chain'
import { type BlockExplorerEntity, chainRegistry } from '@vultisig/core-chain/chainRegistry'

type GetBlockExplorerUrlInput = {
  chain: Chain
  entity: BlockExplorerEntity
  value: string
}

export const getBlockExplorerUrl = ({ chain, entity, value }: GetBlockExplorerUrlInput): string => {
  const explorer = chainRegistry[chain].explorer
  return `${explorer.baseUrl}${explorer.paths[entity]}${value}`
}
