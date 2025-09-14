import { EvmChain } from '../../../Chain'
import { getEvmClient } from '../../../chains/evm/client'
import { shouldBePresent } from '../../../../../lib/utils/assert/shouldBePresent'

export const getEvmBaseFee = async (chain: EvmChain) => {
  const client = getEvmClient(chain)
  const { baseFeePerGas } = await client.getBlock()

  return shouldBePresent(baseFeePerGas)
}
