import { Chain } from '@vultisig/core-chain/Chain'

import { ChainEntity } from './ChainEntity'

export type ChainAccount<T extends Chain = Chain> = ChainEntity<T> & {
  address: string
}
