import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'

/** The node's current legacy gas price (`eth_gasPrice`), in wei. */
export const getEvmGasPrice = async (chain: EvmChain): Promise<bigint> => getEvmClient(chain).getGasPrice()
