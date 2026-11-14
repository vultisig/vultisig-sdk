import { Chain } from '@vultisig/core-chain/Chain'

import { getNativeChainNameResolver } from '../getNativeChainNameResolver'

/** THORNames (`.thor`), looked up on THORNode. */
export const thornameResolver = getNativeChainNameResolver(Chain.THORChain)
