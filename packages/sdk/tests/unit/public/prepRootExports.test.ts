import { describe, expect, it } from 'vitest'

import * as root from '@/index'
import { prepareThorchainMsgDepositTxFromKeys, resolveSourceChannelByDestChain } from '@/index'
import * as tools from '@/tools'
import { resolveSourceChannelByDestChain as resolveSourceChannelByDestChainFromTools } from '@/tools'
import * as prep from '@/tools/prep'
import {
  prepareThorchainMsgDepositTxFromKeys as prepareThorchainMsgDepositTxFromKeysFromPrep,
  resolveSourceChannelByDestChain as resolveSourceChannelByDestChainFromPrep,
} from '@/tools/prep'
import * as ibc from '@/tools/prep/ibcTransfer'

describe('SDK root prep exports', () => {
  it('exposes canonical IBC lookups through all public barrels and the prep namespace', () => {
    for (const name of ['getIbcDestinationChainId', 'getIbcCounterpartyChannel'] as const) {
      expect(root[name]).toBe(ibc[name])
      expect(tools[name]).toBe(ibc[name])
      expect(prep[name]).toBe(ibc[name])
      expect(root.prep[name]).toBe(ibc[name])
    }
    expect(root.getIbcDestinationChainId(' Cosmos ', 'channel-536')).toBe('noble-1')
    expect(root.getIbcCounterpartyChannel('Cosmos', ' channel-536 ')).toBe('channel-4')
  })

  it('re-exports prepareThorchainMsgDepositTxFromKeys from the public root surface', () => {
    expect(prepareThorchainMsgDepositTxFromKeys).toBe(prepareThorchainMsgDepositTxFromKeysFromPrep)
  })

  it('re-exports the canonical IBC reverse route lookup through every public barrel', () => {
    expect(resolveSourceChannelByDestChain).toBe(resolveSourceChannelByDestChainFromTools)
    expect(resolveSourceChannelByDestChain).toBe(resolveSourceChannelByDestChainFromPrep)
    expect(resolveSourceChannelByDestChain('osmosis-1', 'noble-1')).toBe('channel-750')
  })
})
