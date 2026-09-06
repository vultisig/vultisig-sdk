import { generalSwapProviderName, generalSwapProviders } from '@vultisig/core-chain/swap/general/GeneralSwapProvider'
import { isOneOf } from '@vultisig/lib-utils/array/isOneOf'
import { matchRecordUnion } from '@vultisig/lib-utils/matchRecordUnion'

import { KeysignSwapPayload } from './KeysignSwapPayload'

/**
 * Provider label for a swap the peer knows only through its keysign payload.
 *
 * Matches `getSwapQuoteProviderName`, which the initiator renders from the live
 * quote, down to the `Provider (ROUTE)` shape — the two screens describe one
 * swap, so a co-signer comparing them should read the same words. Aggregators
 * that route directly, and senders that predate `sub_provider`, leave it empty
 * and are named alone.
 */
export const getKeysignSwapProviderName = (swapPayload: KeysignSwapPayload) =>
  matchRecordUnion<KeysignSwapPayload, string>(swapPayload, {
    native: ({ chain }) => chain,
    general: ({ provider, subProvider }) => {
      const name = isOneOf(provider, generalSwapProviders) ? generalSwapProviderName[provider] : provider

      return subProvider ? `${name} (${subProvider})` : name
    },
  })
