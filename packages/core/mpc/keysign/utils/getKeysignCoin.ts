import { Chain } from '@vultisig/core-chain/Chain'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'

import { fromCommCoin } from '../../types/utils/commCoin'

export const getKeysignCoin = <T extends Chain = Chain>({
  coin,
}: KeysignPayload): AccountCoin<T> => fromCommCoin<T>(shouldBePresent(coin))
