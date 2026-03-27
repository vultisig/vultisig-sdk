import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'

export const getEvmMaxPriorityFeePerGas = async (chain: EvmChain) =>
  getEvmClient(chain).estimateMaxPriorityFeePerGas()
