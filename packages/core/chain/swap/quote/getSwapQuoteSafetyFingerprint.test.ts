import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { getSwapQuoteSafetyFingerprint } from './getSwapQuoteSafetyFingerprint'

const coin = {
  chain: Chain.Ethereum,
  address: '0x1111111111111111111111111111111111111111',
  id: '0x2222222222222222222222222222222222222222',
  ticker: 'TOKEN',
  decimals: 18,
}

const fingerprint = (value: unknown) =>
  getSwapQuoteSafetyFingerprint({
    from: coin,
    to: coin,
    requestedAmount: 1n,
    expiresAt: 1,
    quote: { general: { value } } as never,
  })

const recipientFingerprint = (recipient: string) =>
  getSwapQuoteSafetyFingerprint({
    from: coin,
    to: coin,
    recipient,
    requestedAmount: 1n,
    expiresAt: 1,
    quote: { general: { value: 'quote' } } as never,
  })

describe('getSwapQuoteSafetyFingerprint', () => {
  it.each(['from', 'to'] as const)('treats blank %s coin IDs as native without changing non-blank IDs', side => {
    const nativeCoin = { ...coin, id: undefined }
    const coinFingerprint = (id?: string) =>
      getSwapQuoteSafetyFingerprint({
        from: coin,
        to: coin,
        [side]: id === undefined ? nativeCoin : { ...nativeCoin, id },
        requestedAmount: 1n,
        expiresAt: 1,
        quote: { general: { value: 'quote' } } as never,
      })

    expect(coinFingerprint('')).toBe(coinFingerprint())
    expect(coinFingerprint('  ')).toBe(coinFingerprint())
    expect(coinFingerprint(coin.id)).not.toBe(coinFingerprint())
    expect(coinFingerprint(' Token ')).not.toBe(coinFingerprint('Token'))
    expect(coinFingerprint('Token')).not.toBe(coinFingerprint('token'))
  })

  it('keeps canonical bigint tags distinct from provider object keys', () => {
    expect(fingerprint(5n)).not.toBe(fingerprint({ $bigint: '5' }))
  })

  it('canonicalizes explicit undefined array values and sparse holes consistently', () => {
    expect(fingerprint([undefined])).toBe(fingerprint(new Array(1)))
  })

  it('binds the effective output recipient', () => {
    expect(recipientFingerprint('thor1recipient')).not.toBe(recipientFingerprint('thor1other'))
  })
})
