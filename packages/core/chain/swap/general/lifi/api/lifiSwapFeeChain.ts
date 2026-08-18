import type { ChainId } from '@lifi/sdk'
import { lifiSwapChainId, LifiSwapEnabledChain } from '@vultisig/core-chain/swap/general/lifi/LifiSwapEnabledChains'
import { mirrorRecord } from '@vultisig/lib-utils/record/mirrorRecord'

const lifiSwapChainById = mirrorRecord(lifiSwapChainId)

// Resolve a LiFi fee-token `chainId` back to a Vultisig `LifiSwapEnabledChain`.
//
// `lifiSwapChainById` is a closed, build-time map of LI.FI source chains (EVM
// chains Vultisig exposes + Solana). LI.FI's `feeCosts[].token` is not
// guaranteed to live on the source chain: an intermediate bridge chain can be
// outside this map. Falling back to the source chain keeps `swap_fee_chain`
// present and reflects the wallet that LI.FI collects the fixed fee from.
export const resolveSwapFeeChain = (chainId: ChainId, fallback: LifiSwapEnabledChain): LifiSwapEnabledChain => {
  const resolved = lifiSwapChainById[chainId]

  if (resolved === undefined) {
    console.warn(`[getLifiSwapQuote] fee token chainId ${chainId} not in lifiSwapChainId; falling back to ${fallback}`)
    return fallback
  }

  return resolved
}
