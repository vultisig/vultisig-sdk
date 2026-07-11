import { describe, expect, it } from 'vitest'

import { prepareThorchainMsgDepositTxFromKeys } from '@/index'
import { prepareThorchainMsgDepositTxFromKeys as prepareThorchainMsgDepositTxFromKeysFromPrep } from '@/tools/prep'

describe('SDK root prep exports', () => {
  it('re-exports prepareThorchainMsgDepositTxFromKeys from the public root surface', () => {
    expect(prepareThorchainMsgDepositTxFromKeys).toBe(prepareThorchainMsgDepositTxFromKeysFromPrep)
  })
})
