import { Chain } from '../../../chain/Chain'
import { AccountCoin } from '../../../chain/coin/AccountCoin'
import { KeysignPayload } from '../../types/vultisig/keysign/v1/keysign_message_pb'
import { shouldBePresent } from '../../../../lib/utils/assert/shouldBePresent'

import { fromCommCoin } from '../../types/utils/commCoin'

export const getKeysignCoin = <T extends Chain = Chain>({
  coin,
}: KeysignPayload): AccountCoin<T> => fromCommCoin<T>(shouldBePresent(coin))
