import { cowSwapSupportedChains } from '@vultisig/core-chain/swap/general/cowswap/config'
import { jupiterSwapEnabledChains } from '@vultisig/core-chain/swap/general/jupiter/JupiterSwapEnabledChains'
import { kyberSwapEnabledChains } from '@vultisig/core-chain/swap/general/kyber/chains'
import { lifiSwapEnabledChains } from '@vultisig/core-chain/swap/general/lifi/LifiSwapEnabledChains'
import { oneInchSwapEnabledChains } from '@vultisig/core-chain/swap/general/oneInch/OneInchSwapEnabledChains'
import { swapKitEnabledChains } from '@vultisig/core-chain/swap/general/swapkit/SwapKitEnabledChains'
import { nativeSwapEnabledChains } from '@vultisig/core-chain/swap/native/NativeSwapChain'

// EVERY provider's enabled-chain list must appear in this union (sdk#1151).
// It used to omit Kyber/Jupiter/CowSwap and was complete only by accident —
// LiFi's list happened to be a superset of theirs. The first provider added
// on a chain LiFi doesn't serve would have silently under-reported
// isSwapSupported/getSupportedChains (which drive the swap picker and the
// Swap primary action). Correctness-by-construction beats a hidden invariant.
export const swapEnabledChains = [
  ...nativeSwapEnabledChains,
  ...cowSwapSupportedChains,
  ...kyberSwapEnabledChains,
  ...oneInchSwapEnabledChains,
  ...jupiterSwapEnabledChains,
  ...lifiSwapEnabledChains,
  ...swapKitEnabledChains,
] as const
