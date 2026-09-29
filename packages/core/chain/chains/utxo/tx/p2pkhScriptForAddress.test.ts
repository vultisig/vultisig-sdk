import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { p2pkhScriptForAddress } from './p2pkhScriptForAddress'

describe('SwapKit legacy P2PKH address scripts', () => {
  it('decodes the CashAddr specification example and checks its checksum', () => {
    const address = 'bitcoincash:qqs3kax2g6r0s8ha54jpwelusnh3dkh7pvu23rzrru'
    expect(p2pkhScriptForAddress(Chain.BitcoinCash, address).toString('hex')).toBe(
      '76a914211b74ca4686f81efda5641767fc84ef16dafe0b88ac'
    )
    expect(() => p2pkhScriptForAddress(Chain.BitcoinCash, address.slice(0, -1) + 'q')).toThrow()
  })

  it('distinguishes DOGE, BCH legacy, and ZEC mainnet prefixes', () => {
    expect(p2pkhScriptForAddress(Chain.Dogecoin, 'D9DTLZMyferY6TVquM7GryViP7GtBntqWj').toString('hex')).toBe(
      '76a9142cb3874ca8f2e1913451785416106ef84e83d58b88ac'
    )
    expect(p2pkhScriptForAddress(Chain.BitcoinCash, '1BpEi6DfDAUFd7GtittLSdBeYJvcoaVggu').toString('hex')).toBe(
      '76a91476a04053bda0a88bda5177b86a15c3b29f55987388ac'
    )
    expect(p2pkhScriptForAddress(Chain.Zcash, 't1bnxtY7aLCjWx9Ru1YcGwRWch3eEWUFK7u').toString('hex')).toBe(
      '76a914c4919dca916dc416c06d51cb1940a7ba268c475d88ac'
    )
    expect(() => p2pkhScriptForAddress(Chain.Dogecoin, '1BpEi6DfDAUFd7GtittLSdBeYJvcoaVggu')).toThrow()
  })
})
