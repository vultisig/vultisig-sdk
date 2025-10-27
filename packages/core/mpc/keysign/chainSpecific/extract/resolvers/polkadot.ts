import { polkadotConfig } from '../../../../../chain/chains/polkadot/config'

import { ExtractFeeQuoteResolver } from '../resolver'

export const extractPolkadotFeeQuote: ExtractFeeQuoteResolver<
  'polkadotSpecific'
> = ({ gas }) => ({
  gas: gas || polkadotConfig.fee,
})
