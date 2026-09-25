import { EvmChain } from '../../../Chain'
import { evmChainTxFeeFormat } from '../../../chains/evm/tx/fee'
import { getEvmBaseFee } from './baseFee'
import { clampEvmPriorityFee, isZeroPriorityFeeChain } from './clampEvmPriorityFee'
import { evmRouterDepositGasLimit } from './evmGasLimit'
import { getEvmGasPrice } from './gasPrice'
import { getEvmMaxPriorityFeePerGas } from './maxPriorityFeePerGas'

export type EvmRouterDepositFee = {
  gasLimit: bigint
  baseFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  fee: bigint
}

/**
 * Prices the fixed-limit router deposit signed for THORChain and Maya swaps.
 * Enveloped transactions reserve 20% base-fee headroom and a safely clamped
 * priority fee; legacy and zero-priority chains retain their signing rules.
 */
export const getEvmRouterDepositFee = async (chain: EvmChain): Promise<EvmRouterDepositFee> => {
  const isLegacyPriced = evmChainTxFeeFormat[chain] === 'legacy'
  const [baseFeePerGas, maxPriorityFeePerGas] = await Promise.all([
    isLegacyPriced ? getEvmGasPrice(chain) : getEvmBaseFee(chain).then(baseFee => (baseFee * 120n) / 100n),
    isLegacyPriced || isZeroPriorityFeeChain(chain)
      ? Promise.resolve(0n)
      : getEvmMaxPriorityFeePerGas(chain).then(priorityFee => clampEvmPriorityFee(chain, priorityFee)),
  ])

  return {
    gasLimit: evmRouterDepositGasLimit,
    baseFeePerGas,
    maxPriorityFeePerGas,
    fee: evmRouterDepositGasLimit * (baseFeePerGas + maxPriorityFeePerGas),
  }
}
