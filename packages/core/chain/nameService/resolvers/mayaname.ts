import { Chain } from '@vultisig/core-chain/Chain'

import { getNativeChainNameResolver } from '../getNativeChainNameResolver'

/** MAYANames (`.maya`), looked up on MAYANode. */
export const mayanameResolver = getNativeChainNameResolver(Chain.MayaChain)
