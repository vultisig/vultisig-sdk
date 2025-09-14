import { create } from '@bufbuild/protobuf'
import { getRippleAccountInfo } from '../../../../chain/chains/ripple/account/info'
import { rippleTxFee } from '../../../../chain/tx/fee/ripple'
import {
  RippleSpecific,
  RippleSpecificSchema,
} from '../../../types/vultisig/keysign/v1/blockchain_specific_pb'

import { ChainSpecificResolver } from '../resolver'

export const getRippleSpecific: ChainSpecificResolver<RippleSpecific> = async ({
  coin,
}) => {
  const rippleAccount = await getRippleAccountInfo(coin.address)

  return create(RippleSpecificSchema, {
    sequence: BigInt(rippleAccount.account_data.Sequence),
    gas: BigInt(rippleTxFee),
    lastLedgerSequence: BigInt((rippleAccount.ledger_current_index ?? 0) + 60),
  })
}
