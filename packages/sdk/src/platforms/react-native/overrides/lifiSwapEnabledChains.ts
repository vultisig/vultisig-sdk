// RN override for `@vultisig/core-chain/swap/general/lifi/LifiSwapEnabledChains`.
//
// The non-RN module statically imports `ChainId` from `@lifi/sdk` and builds
// the `lifiSwapChainId` record eagerly at module-init. `@lifi/sdk`'s barrel
// transitively imports `@wallet-standard/app`, which evaluates
// `class AppReadyEvent extends Event` at module top-level — Hermes ships
// without the `Event` global, so touching the barrel crashes
// `sdk.initialize()`.
//
// On RN we inline the numeric `ChainId.SOL` value (which is the only
// non-EVM enum value we consume) so this module has zero dependency on
// `@lifi/sdk` at module-init. The EVM chain ids come from viem via
// `getEvmChainId`, which is Hermes-safe. Public shape matches the core
// module exactly: `lifiSwapEnabledChains` tuple + `LifiSwapEnabledChain`
// type + `lifiSwapChainId` const record.
import { Chain, EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmChainId } from '@vultisig/core-chain/chains/evm/chainInfo'
import { hexToNumber } from '@vultisig/lib-utils/hex/hexToNumber'
import { makeRecord } from '@vultisig/lib-utils/record/makeRecord'
import type { ChainId } from '@lifi/sdk'

export const lifiSwapEnabledChains = [
  ...Object.values(EvmChain),
  Chain.Solana,
] as const

export type LifiSwapEnabledChain = (typeof lifiSwapEnabledChains)[number]

// Pinned to `ChainId.SOL` in `@lifi/sdk` (from @lifi/types
// src/chains/base.ts). Kept as a numeric literal so this module does not
// load `@lifi/sdk` at module-init on Hermes.
const LIFI_CHAIN_ID_SOL = 1151111081099710 as ChainId

export const lifiSwapChainId: Record<LifiSwapEnabledChain, ChainId> = {
  ...makeRecord(Object.values(EvmChain), chain =>
    hexToNumber(getEvmChainId(chain))
  ),
  [Chain.Solana]: LIFI_CHAIN_ID_SOL,
}
