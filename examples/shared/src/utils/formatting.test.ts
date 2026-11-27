import { describe, expect, it } from 'vitest'

import { getChainNativeDecimals, getChainNativeTicker, isUtxoChain, parseSelectedUtxosInput } from './formatting'

// Regression for the local-map drift found in VaultSend/VaultSwap: these chains
// were previously missing (or wrong) in the hand-rolled tickerMap/decimalsMap
// copies before both were replaced with the SDK's canonical chainFeeCoin.
describe('getChainNativeTicker / getChainNativeDecimals', () => {
  it.each([
    ['Ton', 'GRAM', 9],
    ['Noble', 'USDC', 6],
    ['Tron', 'TRX', 6],
    ['Polygon', 'POL', 18],
    ['Mantle', 'MNT', 18],
    ['Hyperliquid', 'HYPE', 18],
    ['Sei', 'SEI', 18],
  ])('resolves %s to canonical ticker %s and decimals %d', (chain, ticker, decimals) => {
    expect(getChainNativeTicker(chain)).toBe(ticker)
    expect(getChainNativeDecimals(chain)).toBe(decimals)
  })

  it('falls back to the chain name / 18 decimals for an unrecognized chain', () => {
    expect(getChainNativeTicker('NotARealChain')).toBe('NotARealChain')
    expect(getChainNativeDecimals('NotARealChain')).toBe(18)
  })
})

describe('isUtxoChain', () => {
  it.each(['Bitcoin', 'Bitcoin-Cash', 'Litecoin', 'Dogecoin', 'Dash', 'Zcash'])(
    'returns true for UTXO chain %s',
    chain => {
      expect(isUtxoChain(chain)).toBe(true)
    }
  )

  it.each(['Ethereum', 'Solana', 'Cardano', 'Cosmos', 'NotARealChain', ''])(
    'returns false for non-UTXO chain %s',
    chain => {
      expect(isUtxoChain(chain)).toBe(false)
    }
  )
})

describe('parseSelectedUtxosInput', () => {
  const hashA = 'aa'.repeat(32)
  const hashB = 'bb'.repeat(32)

  it('parses newline-delimited candidate UTXOs and sums their total', () => {
    const parsed = parseSelectedUtxosInput(`\n ${hashA.toUpperCase()}:0:50000000 \n\n${hashB}:1:10000000\n`)
    expect(parsed).toEqual({
      ok: true,
      utxos: [
        { hash: hashA, index: 0, amount: '50000000' },
        { hash: hashB, index: 1, amount: '10000000' },
      ],
      totalAmount: 60_000_000n,
    })
  })

  it.each([
    ['empty input', '   \n  ', /at least one UTXO/],
    ['missing fields', 'onlyhash:0', /Line 1: expected txid:vout:satoshis/],
    ['bad txid', 'abcd:0:1000', /Line 1: txid must be 64 hex/],
    ['overflow vout', `${hashA}:4294967296:1000`, /Line 1: vout must be a uint32/],
    ['zero satoshis', `${hashA}:0:0`, /Line 1: satoshis must be a positive/],
    ['duplicate outpoint', `${hashA.toUpperCase()}:0:1000\n${hashA}:0:1000`, /Line 2: duplicate outpoint/],
  ])('rejects %s', (_label, raw, pattern) => {
    const parsed = parseSelectedUtxosInput(raw)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.message).toMatch(pattern)
    }
  })
})
