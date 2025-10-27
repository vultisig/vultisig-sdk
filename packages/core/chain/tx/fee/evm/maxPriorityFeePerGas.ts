import { EvmChain } from '../../../Chain'
import { getEvmClient } from '../../../chains/evm/client'

export const getEvmMaxPriorityFeePerGas = async (chain: EvmChain) =>
  getEvmClient(chain).estimateMaxPriorityFeePerGas()
