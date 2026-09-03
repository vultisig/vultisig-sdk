import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { getKeysignSwapProviderName } from './getKeysignSwapProviderName'
import type { KeysignSwapPayload } from './KeysignSwapPayload'

const swapkitPayload = (subProvider: string) =>
  ({
    general: {
      provider: 'swapkit',
      subProvider,
      fromAmount: '0',
      toAmountDecimal: '0',
      txType: 'TRANSFER',
      targetAddress: 't1Deposit',
      swapId: '',
    },
  }) as unknown as KeysignSwapPayload

describe('getKeysignSwapProviderName', () => {
  it('names the swap chain for native swaps', () => {
    const payload = { native: { chain: Chain.THORChain } } as unknown as KeysignSwapPayload

    expect(getKeysignSwapProviderName(payload)).toBe(Chain.THORChain)
  })

  it('maps a general provider to its display name', () => {
    const payload = { general: { provider: 'kyber' } } as unknown as KeysignSwapPayload

    expect(getKeysignSwapProviderName(payload)).toBe('KyberSwap')
  })

  it('appends the route the payload names, matching what the initiator renders', () => {
    // The initiator reads `SwapKit (NEAR)` off the live quote. A joiner showing
    // a bare `SwapKit` for the same swap reads as a different route to whoever
    // compares the two screens (vultisig-windows#4362).
    expect(getKeysignSwapProviderName(swapkitPayload('NEAR'))).toBe('SwapKit (NEAR)')
  })

  it('names the aggregator alone when the payload carries no route', () => {
    // Senders that predate `sub_provider` leave it empty, and payload shapes
    // without the field never had one.
    expect(getKeysignSwapProviderName(swapkitPayload(''))).toBe('SwapKit')
  })
})
