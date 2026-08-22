import { ChainId } from '@lifi/sdk'
import { describe, expect, it } from 'vitest'

import { LIFI_CHAIN_ID_SOL } from '../../../../src/platforms/react-native/overrides/lifiSwapEnabledChains'

// Non-RN test (Node has a global `Event`, so importing the real `@lifi/sdk`
// barrel here is safe - only Hermes/RN crashes on it). Asserts the RN
// override's pinned numeric literal still matches the live enum, so a LiFi
// renumber fails CI instead of drifting silently (sdk#1374).
describe('LIFI_CHAIN_ID_SOL (RN override pin)', () => {
  it('matches the live ChainId.SOL from @lifi/sdk', () => {
    expect(LIFI_CHAIN_ID_SOL).toBe(ChainId.SOL)
  })
})
