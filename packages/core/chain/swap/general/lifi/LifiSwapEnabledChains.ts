import { Chain, EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmChainId } from '@vultisig/core-chain/chains/evm/chainInfo'
import { hexToNumber } from '@vultisig/lib-utils/hex/hexToNumber'
import { memoize } from '@vultisig/lib-utils/memoize'
import { makeRecord } from '@vultisig/lib-utils/record/makeRecord'
import type { ChainId } from '@lifi/sdk'

export const lifiSwapEnabledChains = [
  ...Object.values(EvmChain),
  Chain.Solana,
] as const

export type LifiSwapEnabledChain = (typeof lifiSwapEnabledChains)[number]

// `@lifi/sdk`'s barrel pulls `@wallet-standard/app`, which does
// `class AppReadyEvent extends Event` at module init. Hermes ships
// without the `Event` global, so touching the barrel from a RN bundle
// crashes `sdk.initialize()` before any swap call is made. Defer the
// `ChainId.SOL` runtime lookup behind a lazy import so the module
// graph only loads when `getLifiSwapQuote` actually runs.
export const getLifiSwapChainId = memoize(
  async (): Promise<Record<LifiSwapEnabledChain, ChainId>> => {
    const { ChainId } = await import('@lifi/sdk')
    return {
      ...makeRecord(Object.values(EvmChain), chain =>
        hexToNumber(getEvmChainId(chain))
      ),
      [Chain.Solana]: ChainId.SOL,
    }
  }
)
