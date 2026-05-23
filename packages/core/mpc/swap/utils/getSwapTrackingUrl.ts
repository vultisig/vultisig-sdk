import { Chain } from '@vultisig/core-chain/Chain'
import { getBlockExplorerUrl } from '@vultisig/core-chain/utils/getBlockExplorerUrl'
import { SwapKitSourceChain } from '@vultisig/core-chain/swap/general/swapkit/SwapKitEnabledChains'
import { stripHexPrefix } from '@vultisig/lib-utils/hex/stripHexPrefix'
import { matchRecordUnion } from '@vultisig/lib-utils/matchRecordUnion'

import { KeysignSwapPayload } from '../../keysign/swap/KeysignSwapPayload'

type GetSwapTrackingUrlInput = {
  swapPayload: KeysignSwapPayload
  txHash: string
  sourceChain: Chain
}

// Chain identifiers accepted by https://track.swapkit.dev/?tx=<hash>&chainId=<id>
// These differ from the SwapKit API chain-prefix map (ETH, ARB, …) used in getSwapKitQuote.ts.
// Source: https://docs.swapkit.dev/swapkit-api/providers-request-supported-chains-by-a-swap-provider#chain-ids-and-corresponding-names
const swapKitTrackerChainId: Record<SwapKitSourceChain, string> = {
  [Chain.Ethereum]: '1',
  [Chain.Arbitrum]: '42161',
  [Chain.Avalanche]: '43114',
  [Chain.Base]: '8453',
  [Chain.BSC]: '56',
  [Chain.Optimism]: '10',
  [Chain.Polygon]: '137',
  [Chain.Solana]: 'solana',
  [Chain.Bitcoin]: 'bitcoin',
  [Chain.BitcoinCash]: 'bitcoincash',
  [Chain.Dogecoin]: 'dogecoin',
  [Chain.Litecoin]: 'litecoin',
  [Chain.Ripple]: 'ripple',
  [Chain.Ton]: 'ton',
  [Chain.Tron]: '728126428',
  [Chain.Zcash]: 'zcash',
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
      if (provider === 'li.fi') {
        return `https://scan.li.fi/tx/${txHash}`
      }
      if (provider === 'swapkit') {
        const chainId = swapKitTrackerChainId[sourceChain as SwapKitSourceChain]
        if (chainId) {
          return `https://track.swapkit.dev/?tx=${txHash}&chainId=${chainId}`
        }
      }
      return getBlockExplorerUrl({
        chain: sourceChain,
        entity: 'tx',
        value: txHash,
      })
    },
  })
}
