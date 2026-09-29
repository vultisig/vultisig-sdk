import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { getUtxoMinSendAmountError, validateUtxoRequirements } from './validateUtxoRequirements'

describe('getUtxoMinSendAmountError', () => {
  it('names the Bitcoin floor for a recipient amount below it', () => {
    const error = getUtxoMinSendAmountError({ amount: 545n, chain: Chain.Bitcoin })

    expect(error).toBe('Minimum send amount is 0.00000546 BTC. Bitcoin requires this to prevent spam.')
    expect(validateUtxoRequirements({ amount: 545n, balance: 545n, chain: Chain.Bitcoin })).toBe(error)
  })

  it('allows a recipient amount equal to the floor', () => {
    expect(getUtxoMinSendAmountError({ amount: 546n, chain: Chain.Bitcoin })).toBeUndefined()
  })
})
