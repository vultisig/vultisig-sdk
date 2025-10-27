import { mayaGas } from '../../../../../chain/feeQuote/resolvers/cosmos'

import { ExtractFeeQuoteResolver } from '../resolver'

export const extractMayaFeeQuote: ExtractFeeQuoteResolver<
  'mayaSpecific'
> = () => ({
  gas: mayaGas,
})
