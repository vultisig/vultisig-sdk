import { describe, expect, it } from 'vitest'

import { resolveSourceChannelByDestChain } from '@/index'
import { resolveSourceChannelByDestChain as resolveSourceChannelByDestChainFromPrep } from '@/tools/prep'

// sdk#<TBD> - build-ibc-transfer consumers still need the reverse route lookup
// that prepareIbcTransfer already uses internally. Keeping it private forces
// first-party consumers to rebuild the SDK's IBC route index locally, which is
// exactly the duplicated-not-imported drift this campaign keeps finding.
describe('SDK root exports the IBC reverse route helper', () => {
  it('re-exports resolveSourceChannelByDestChain as the same reference as the prep barrel', () => {
    expect(resolveSourceChannelByDestChain).toBe(resolveSourceChannelByDestChainFromPrep)
    expect(resolveSourceChannelByDestChain('osmosis-1', 'cosmoshub-4')).toBe('channel-0')
    expect(resolveSourceChannelByDestChain('cosmoshub-4', 'juno-1')).toBeNull()
  })
})
