import { describe, expect, it } from 'vitest'

import { parseThorchainTxResult } from './getThorchainTxResult'

describe('parseThorchainTxResult', () => {
  it('parses an accepted transaction', () => {
    expect(parseThorchainTxResult({ tx_response: { code: 0, raw_log: '' } })).toEqual({ code: 0, rawLog: '' })
  })

  it('parses a rejection with its log', () => {
    expect(parseThorchainTxResult({ tx_response: { code: 5, raw_log: 'insufficient funds' } })).toEqual({
      code: 5,
      rawLog: 'insufficient funds',
    })
  })

  // Callers read any nonzero code as a rejection, so a malformed body must be
  // "no information", never a verdict. ABCI codes are non-negative integers.
  it.each([
    ['a negative code', { tx_response: { code: -1 } }],
    ['a fractional code', { tx_response: { code: 0.5 } }],
    ['a NaN code', { tx_response: { code: Number.NaN } }],
    ['a string code', { tx_response: { code: '0' } }],
    ['a missing code', { tx_response: {} }],
    ['a missing tx_response', {}],
    ['a non-object body', 'not found'],
    [null, null],
  ])('returns null for %s', (_label, body) => {
    expect(parseThorchainTxResult(body)).toBeNull()
  })

  it('tolerates a missing raw_log on a valid code', () => {
    expect(parseThorchainTxResult({ tx_response: { code: 3 } })).toEqual({ code: 3, rawLog: '' })
  })
})
