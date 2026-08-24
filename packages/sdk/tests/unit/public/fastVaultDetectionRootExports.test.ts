import * as canonical from '@vultisig/core-mpc/devices/localPartyId'
import { describe, expect, it } from 'vitest'

import * as sdk from '../../../src/index'

describe('fast-vault detection root exports', () => {
  it('exports the canonical server-signer helpers by identity', () => {
    expect(sdk.hasServer).toBe(canonical.hasServer)
    expect(sdk.isServer).toBe(canonical.isServer)
  })

  it('detects legacy VultiServer signers from the supported SDK root', () => {
    expect(sdk.hasServer(['iPhone-current', 'VultiServer-legacy'])).toBe(true)
    expect(sdk.isServer('VultiServer-legacy')).toBe(true)
  })
})
