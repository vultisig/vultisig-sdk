import { describe, expect, it } from 'vitest'

import { parseThorchainSwapMemoStreaming } from './parseThorchainSwapMemoStreaming'

describe('parseThorchainSwapMemoStreaming', () => {
  it('parses trailing tolerance/interval/quantity', () => {
    expect(
      parseThorchainSwapMemoStreaming(
        '=:e:0x86d526d6624AbC0178cF7296cD538Ecc080A95F1:0/1/13'
      )
    ).toEqual({ streamingInterval: '1', streamingQuantity: '13' })
  })

  it('uses the last matching triple segment', () => {
    expect(
      parseThorchainSwapMemoStreaming('=:ETH.ETH:0xabc:0/1/0:0/2/5')
    ).toEqual({ streamingInterval: '2', streamingQuantity: '5' })
  })

  it('returns 0/0 when no triple suffix exists', () => {
    expect(parseThorchainSwapMemoStreaming('=:e:0x86d526d6624AbC0178cF7296cD538Ecc080A95F1')).toEqual({
      streamingInterval: '0',
      streamingQuantity: '0',
    })
  })
})
