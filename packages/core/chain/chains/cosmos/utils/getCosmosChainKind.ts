import {
  CosmosChain,
  CosmosChainKind,
  cosmosChainsByKind,
} from '@vultisig/core-chain/Chain'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'

export function getCosmosChainKind(chain: CosmosChain): CosmosChainKind {
  const [key] = shouldBePresent(
    Object.entries(cosmosChainsByKind).find(([_, value]) => chain in value)
  )

  return key as CosmosChainKind
}
