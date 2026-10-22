import { Chain } from '@vultisig/core-chain/Chain'
import { Resolver } from '@vultisig/lib-utils/types/Resolver'

import { NameServiceResolution } from './NameServiceResolution'

/** A name to look up and the chain its address is wanted for. */
export type NameServiceResolverInput = {
  /** The full name, suffix included, trimmed and lowercased. */
  name: string
  chain: Chain
}

/** One name service: which chains it can hold addresses for, and the lookup itself. */
export type NameServiceResolver = {
  isChainSupported: (chain: Chain) => boolean
  resolve: Resolver<NameServiceResolverInput, Promise<NameServiceResolution>>
}
