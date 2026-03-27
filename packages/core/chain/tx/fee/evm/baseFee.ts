import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'

export const getEvmBaseFee = async (chain: EvmChain) => {
  const client = getEvmClient(chain)
  const { baseFeePerGas } = await client.getBlock()

  return shouldBePresent(baseFeePerGas)
}
