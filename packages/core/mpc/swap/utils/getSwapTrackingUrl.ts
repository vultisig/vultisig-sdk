import { Chain } from '@vultisig/core-chain/Chain'
import { getCowSwapExplorerOrderUrl } from '@vultisig/core-chain/swap/general/cowswap/getCowSwapExplorerOrderUrl'
import { getSwapKitTrackerUrl } from '@vultisig/core-chain/swap/general/swapkit/getSwapKitTrackerUrl'
import { getBlockExplorerUrl } from '@vultisig/core-chain/utils/getBlockExplorerUrl'
import { stripHexPrefix } from '@vultisig/lib-utils/hex/stripHexPrefix'
import { matchRecordUnion } from '@vultisig/lib-utils/matchRecordUnion'

import { KeysignSwapPayload } from '../../keysign/swap/KeysignSwapPayload'

type GetSwapTrackingUrlInput = {
  swapPayload: KeysignSwapPayload
  txHash: string
  sourceChain: Chain
}

export const getSwapTrackingUrl = ({ swapPayload, txHash, sourceChain }: GetSwapTrackingUrlInput): string => {
  return matchRecordUnion<KeysignSwapPayload, string>(swapPayload, {
    native: ({ chain }) => {
      if (chain === Chain.THORChain) {
        return `https://runescan.io/tx/${stripHexPrefix(txHash)}`
      }
      return getBlockExplorerUrl({
        chain,
        entity: 'tx',
        value: txHash,
      })
    },
    general: ({ provider }) => {
      // CowSwap orders settle off-chain; while PENDING the `txHash` is the order
      // UID (not an on-chain hash), so link to the order's CoW Explorer page. On
      // fill, the consumer replaces this with the settlement tx's block-explorer
      // link.
      if (provider === 'cowswap') {
        // The order UID keeps its 0x prefix in CoW Explorer order URLs.
        return getCowSwapExplorerOrderUrl({ chain: sourceChain, uid: txHash })
      }
      if (provider === 'li.fi') {
        return `https://scan.li.fi/tx/${txHash}`
      }
      if (provider === 'swapkit') {
        const trackerUrl = getSwapKitTrackerUrl({ chain: sourceChain, txHash })
        if (trackerUrl) return trackerUrl

        console.warn(
          `[getSwapTrackingUrl] SwapKit tracker chainId missing for ${sourceChain} — falling back to source-chain block explorer. Add a swapKitTrackerChainIds entry.`
        )
      }
      return getBlockExplorerUrl({
        chain: sourceChain,
        entity: 'tx',
        value: txHash,
      })
    },
  })
}
