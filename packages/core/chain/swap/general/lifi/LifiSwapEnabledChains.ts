import { Chain, EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmChainId } from '@vultisig/core-chain/chains/evm/chainInfo'
import { hexToNumber } from '@vultisig/lib-utils/hex/hexToNumber'
import { makeRecord } from '@vultisig/lib-utils/record/makeRecord'
import { ChainId } from '@lifi/sdk'

export const lifiSwapEnabledChains = [
  ...Object.values(EvmChain),
  Chain.Solana,
] as const

export type LifiSwapEnabledChain = (typeof lifiSwapEnabledChains)[number]

export const lifiSwapChainId: Record<LifiSwapEnabledChain, ChainId> = {
  ...makeRecord(Object.values(EvmChain), chain =>
    hexToNumber(getEvmChainId(chain))
  ),
  [Chain.Solana]: ChainId.SOL,
}
