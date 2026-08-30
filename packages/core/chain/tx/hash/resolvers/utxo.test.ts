import { describe, expect, it } from 'vitest'

import { getUtxoTxHash } from './utxo'

describe('getUtxoTxHash', () => {
  it('prefers signingResultV2.txid, reversed to display hex', () => {
    // WalletCore stores txid internal-byte-order; explorers want reversed hex.
    const txid = Uint8Array.from([0x01, 0x02, 0x03, 0x04])
    expect(getUtxoTxHash({ transactionId: 'ignored', signingResultV2: { txid } } as never)).toBe('04030201')
  })

  it('falls back to transactionId when signingResultV2 is absent', () => {
    expect(getUtxoTxHash({ transactionId: 'aabbccdd' } as never)).toBe('aabbccdd')
  })

  it('falls back to transactionId when signingResultV2.txid is empty', () => {
    expect(
      getUtxoTxHash({ transactionId: 'aabbccdd', signingResultV2: { txid: new Uint8Array() } } as never)
    ).toBe('aabbccdd')
  })
})
