import { kyberSwapEnabledChains } from '@vultisig/core-chain/swap/general/kyber/chains'
import { lifiSwapEnabledChains } from '@vultisig/core-chain/swap/general/lifi/LifiSwapEnabledChains'
import { oneInchSwapEnabledChains } from '@vultisig/core-chain/swap/general/oneInch/OneInchSwapEnabledChains'
import { swapKitEnabledChains } from '@vultisig/core-chain/swap/general/swapkit/SwapKitEnabledChains'
import { nativeSwapEnabledChains } from '@vultisig/core-chain/swap/native/NativeSwapChain'

export const swapEnabledChains = [
  ...nativeSwapEnabledChains,
  ...oneInchSwapEnabledChains,
  ...lifiSwapEnabledChains,
  ...swapKitEnabledChains,
  ...kyberSwapEnabledChains,
] as const
