import { Chain } from '@vultisig/core-chain/Chain'

export const rujiTradeSwapEnabledChains = [Chain.THORChain] as const

export const rujiTradeAsset = {
  rune: {
    quoteAsset: 'THOR.RUNE',
    finDenom: 'rune',
  },
  brune: {
    quoteAsset: 'x/brune',
    finDenom: 'x/brune',
  },
} as const

export const rujiTradeDefaultSlippageBps = 100
// RUJI's native swap module treats a two-minute quote as non-executable during its final minute.
// Expose that same effective signing window so callers refresh before the safety buffer begins.
export const rujiTradeQuoteTtlMs = 60_000
