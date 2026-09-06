import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { getKeysignSwapFeeFields } from './getKeysignSwapFeeFields'
import type { GeneralSwapPayload } from './KeysignSwapPayload'

describe('getKeysignSwapFeeFields', () => {
  it('reads the group off the quoted transaction for 1inch-shaped payloads', () => {
    const payload = {
      provider: 'li.fi',
      quote: {
        tx: { swapFee: '40000', swapFeeChain: Chain.Ethereum, swapFeeTokenId: '0xusdc', swapFeeDecimals: 6 },
      },
    } as unknown as GeneralSwapPayload

    expect(getKeysignSwapFeeFields(payload)).toMatchObject({
      swapFee: '40000',
      swapFeeChain: Chain.Ethereum,
      swapFeeTokenId: '0xusdc',
      swapFeeDecimals: 6,
    })
  })

  it('reads the group off the payload for SwapKit transfer routes', () => {
    // These routes quote no transaction, so the fee has nowhere else to live.
    const payload = {
      provider: 'swapkit',
      txType: 'TRANSFER',
      swapFee: '250000',
      swapFeeChain: Chain.Zcash,
      swapFeeDecimals: 8,
    } as unknown as GeneralSwapPayload

    expect(getKeysignSwapFeeFields(payload)).toMatchObject({
      swapFee: '250000',
      swapFeeChain: Chain.Zcash,
      swapFeeDecimals: 8,
    })
  })

  it('reports no fee when the payload quotes no transaction and states none', () => {
    const payload = { provider: 'li.fi' } as unknown as GeneralSwapPayload

    expect(getKeysignSwapFeeFields(payload)).toEqual({ swapFee: '' })
  })
})
