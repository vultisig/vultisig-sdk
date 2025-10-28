import { rippleTxFee } from '../../tx/fee/ripple'

import { FeeQuoteResolver } from '../resolver'

export const getRippleFeeQuote: FeeQuoteResolver<'ripple'> = async () => {
  return { gas: BigInt(rippleTxFee) }
}
