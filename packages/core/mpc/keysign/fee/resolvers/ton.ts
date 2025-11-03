import { tonConfig } from '../../../../chain/chains/ton/config'

import { FeeAmountResolver } from '../resolver'

export const getTonFeeAmount: FeeAmountResolver = () => {
  return tonConfig.fee
}
