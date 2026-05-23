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
// These differ from the SwapKit API chain-prefix map (ETH, ARB, ...) used in getSwapKitQuote.ts.
// Source: https://docs.swapkit.dev/swapkit-api/providers-request-supported-chains-by-a-swap-provider#chain-ids-and-corresponding-names
//
// UTXO byte-order contract: track.swapkit.dev accepts UTXO tx hashes in their
// natural txid representation (the byte-reversed, human-readable form that block
// explorers display). Our signing flow produces hashes in that same display form,
// so no additional byte reversal is needed here.
// The `satisfies Record<SwapKitSourceChain, string>` below enforces compile-time
// exhaustiveness -- adding a chain to SwapKitEnabledChains without updating this
// map is a type error.
const swapKitTrackerChainId = {
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
} satisfies Record<SwapKitSourceChain, string>

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
          // Guard: TON hashes are hex-encoded (see packages/core/chain/tx/hash/resolvers/ton.ts).
          // A `0x`-prefixed TON hash indicates a misconfigured upstream -- stripHexPrefix would
          // silently corrupt it by stripping the first two hex chars, producing a wrong hash.
          if (sourceChain === Chain.Ton && txHash.startsWith('0x')) {
            throw new Error(`TON tx hash must not have a 0x prefix (got: ${txHash.slice(0, 10)}...)`)
          }
          // Bare hash (no `0x` prefix) -- `stripHexPrefix` is a no-op when the
          // hash is already prefix-free (UTXO chains, Ripple, TON, etc.) and strips
          // `0x` from EVM hashes to match track.swapkit.dev's expected format.
          return `https://track.swapkit.dev/?tx=${encodeURIComponent(stripHexPrefix(txHash))}&chainId=${chainId}`
        }
        // SwapKitSourceChain extended without updating swapKitTrackerChainId
        // -> silent fallback to block explorer would degrade tracking
        // without surfacing the gap. Warn so the drift shows up in logs +
        // greppable CI output.
        // TODO: wire to telemetry event 'swapkit_tracker_chain_missing' so
        // mapping drift is caught in production monitoring, not just CI logs.

        console.warn(
          `[getSwapTrackingUrl] SwapKit tracker chainId missing for ${sourceChain} — falling back to source-chain block explorer. Add a swapKitTrackerChainId entry.`
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
