import { generalSwapProviderName, generalSwapProviders } from '@vultisig/core-chain/swap/general/GeneralSwapProvider'
import { isOneOf } from '@vultisig/lib-utils/array/isOneOf'
import { matchRecordUnion } from '@vultisig/lib-utils/matchRecordUnion'

import { KeysignSwapPayload } from './KeysignSwapPayload'

/**
 * Provider label for a swap the peer knows only through its keysign payload.
 *
 * Matches `getSwapQuoteProviderName`, which the initiator renders from the live
 * quote, down to the `Provider (ROUTE)` shape — the two screens describe one
 * swap, so a co-signer comparing them should read the same words. The route
 * tag survives only on payloads that carry `sub_provider`; the rest name the
 * aggregator alone, as they always have.
 */
export const getKeysignSwapProviderName = (swapPayload: KeysignSwapPayload) =>
  matchRecordUnion<KeysignSwapPayload, string>(swapPayload, {
    native: ({ chain }) => chain,
    general: payload => {
      const { provider } = payload
      const name = isOneOf(provider, generalSwapProviders) ? generalSwapProviderName[provider] : provider
      const subProvider = 'subProvider' in payload ? payload.subProvider : undefined

      return subProvider ? `${name} (${subProvider})` : name
    },
  })
