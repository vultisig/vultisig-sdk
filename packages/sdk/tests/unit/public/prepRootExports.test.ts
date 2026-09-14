import { describe, expect, it } from 'vitest'

import { prepareThorchainMsgDepositTxFromKeys, resolveSourceChannelByDestChain } from '@/index'
import { resolveSourceChannelByDestChain as resolveSourceChannelByDestChainFromTools } from '@/tools'
import {
  prepareThorchainMsgDepositTxFromKeys as prepareThorchainMsgDepositTxFromKeysFromPrep,
  resolveSourceChannelByDestChain as resolveSourceChannelByDestChainFromPrep,
} from '@/tools/prep'

describe('SDK root prep exports', () => {
  it('re-exports prepareThorchainMsgDepositTxFromKeys from the public root surface', () => {
    expect(prepareThorchainMsgDepositTxFromKeys).toBe(prepareThorchainMsgDepositTxFromKeysFromPrep)
  })

  it('re-exports the canonical IBC reverse route lookup through every public barrel', () => {
    expect(resolveSourceChannelByDestChain).toBe(resolveSourceChannelByDestChainFromTools)
    expect(resolveSourceChannelByDestChain).toBe(resolveSourceChannelByDestChainFromPrep)
    expect(resolveSourceChannelByDestChain('osmosis-1', 'noble-1')).toBe('channel-750')
  })
})
