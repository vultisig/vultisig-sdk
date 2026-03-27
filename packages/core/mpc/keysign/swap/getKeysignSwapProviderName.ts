import {
  generalSwapProviderName,
  generalSwapProviders,
} from '@vultisig/core-chain/swap/general/GeneralSwapProvider'
import { isOneOf } from '@vultisig/lib-utils/array/isOneOf'
import { matchRecordUnion } from '@vultisig/lib-utils/matchRecordUnion'

import { KeysignSwapPayload } from './KeysignSwapPayload'

export const getKeysignSwapProviderName = (swapPayload: KeysignSwapPayload) =>
  matchRecordUnion<KeysignSwapPayload, string>(swapPayload, {
    native: ({ chain }) => chain,
    general: ({ provider }) =>
      isOneOf(provider, generalSwapProviders)
        ? generalSwapProviderName[provider]
        : provider,
  })
