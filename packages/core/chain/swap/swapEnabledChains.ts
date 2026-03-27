import { lifiSwapEnabledChains } from '@vultisig/core-chain/swap/general/lifi/LifiSwapEnabledChains'
import { oneInchSwapEnabledChains } from '@vultisig/core-chain/swap/general/oneInch/OneInchSwapEnabledChains'
import { nativeSwapEnabledChains } from '@vultisig/core-chain/swap/native/NativeSwapChain'

export const swapEnabledChains = [
  ...nativeSwapEnabledChains,
  ...oneInchSwapEnabledChains,
  ...lifiSwapEnabledChains,
] as const
