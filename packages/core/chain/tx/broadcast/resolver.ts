import { Resolver } from '@vultisig/lib-utils/types/Resolver'

import { Chain } from '../../Chain'
import { SigningOutput } from '../../tw/signingOutput'

/**
 * `default` — single RPC via the chain client (current behaviour).
 * `raced-public-rpc` — EVM-only opt-in: race public endpoints so a
 * Blink-Protect / private-mempool proxy cannot silently drop the tx.
 */
export type BroadcastStrategy = 'default' | 'raced-public-rpc'

export type BroadcastTxResolver<T extends Chain = Chain> = Resolver<
  {
    chain: T
    tx: SigningOutput<T>
    strategy?: BroadcastStrategy
  },
  Promise<unknown>
>
