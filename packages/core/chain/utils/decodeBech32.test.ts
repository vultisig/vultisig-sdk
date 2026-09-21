import { describe, expect, it } from 'vitest'

import { decodeBech32 } from './decodeBech32'

describe('decodeBech32', () => {
  it('decodes a 20-byte account address', () => {
    const { prefix, data } = decodeBech32('qbtc10hmrwslfvxtaaag8rrk3vqr5f5uj7z80z9p9nd')

    expect(prefix).toBe('qbtc')
    expect(data).toHaveLength(20)
  })

  it('decodes a 32-byte address', () => {
    const { prefix, data } = decodeBech32('thor1qv9pzxqlyckngw6zf9g9whn9d3eh4qvg37tfmf9tk2uup37w6hwqhgev59')

    expect(prefix).toBe('thor')
    expect(data).toHaveLength(32)
  })

  it('accepts an uppercase address', () => {
    expect(decodeBech32('QBTC10HMRWSLFVXTAAAG8RRK3VQR5F5UJ7Z80Z9P9ND').prefix).toBe('qbtc')
  })

  it('throws on a bad checksum', () => {
    expect(() => decodeBech32('qbtc10hmrwslfvxtaaag8rrk3vqr5f5uj7z80z9p9nc')).toThrow()
  })

  it('throws on input without a separator', () => {
    expect(() => decodeBech32('not-a-bech32-address')).toThrow()
  })

  it('throws on an address longer than the BIP-173 cap', () => {
    expect(() => decodeBech32(`qbtc1${'q'.repeat(90)}`)).toThrow()
  })
})
