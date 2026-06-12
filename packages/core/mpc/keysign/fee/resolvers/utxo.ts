import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'

import { getUtxoSigningInputs } from '../../signingInputs/resolvers/utxo'
import { FeeAmountResolver } from '../resolver'

export const getUtxoFeeAmount: FeeAmountResolver = async input => {
  const [signingInput] = await getUtxoSigningInputs(input)

  return BigInt(shouldBePresent(signingInput?.plan?.fee?.toString(), `UTXO signing input plan fee`))
}
