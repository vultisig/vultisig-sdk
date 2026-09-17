import { afterEach, describe, expect, it, vi } from 'vitest'

import { decodeTrc20TransferData } from './decodeTrc20TransferData'

const recipient = '00112233445566778899aabbccddeeff00112233'
const addressWord = recipient.padStart(64, '0')

describe('decodeTrc20TransferData', () => {
  afterEach(() => vi.restoreAllMocks())
  it.each(['', '0x'])('decodes ABI transfer data with prefix "%s"', prefix => {
    const data = `${prefix}a9059cbb${addressWord}${'f'.repeat(64)}`
    expect(decodeTrc20TransferData(data)).toEqual({ recipient: `41${recipient}`, amount: (1n << 256n) - 1n })
  })
  it('preserves a zero amount', () => {
    expect(decodeTrc20TransferData(`a9059cbb${addressWord}${'0'.repeat(64)}`)).toEqual({
      recipient: `41${recipient}`,
      amount: 0n,
    })
  })
  it.each(['', '0x', '095ea7b3', `095ea7b3${addressWord}${'0'.repeat(64)}`])('ignores non-transfer data %s', data => {
    expect(decodeTrc20TransferData(data)).toBeNull()
  })
  it.each(['a9059cbb', `a9059cbb${addressWord}`, `a9059cbb${addressWord}${'z'.repeat(64)}`])(
    'returns null and reports malformed amount data',
    data => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      expect(decodeTrc20TransferData(data)).toBeNull()
      expect(error).toHaveBeenCalledWith('Error decoding TRC20 transfer data:', expect.any(SyntaxError))
    }
  )
})
