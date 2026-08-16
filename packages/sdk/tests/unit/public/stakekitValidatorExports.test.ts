/**
 * sdk#1902: the StakeKit action preflight validators are pure SDK canonicals and are
 * already used internally by the builders, but they were stranded inside the module —
 * absent from every public entrypoint. Downstream consumers therefore re-declared the
 * same address/amount rules even after the SDK owned them.
 *
 * Identity assertions (`toBe`, not `typeof`) so a re-implementation on any surface —
 * rather than a re-export of the one canonical — fails here.
 *
 * The react-native entry is asserted in tests/unit/platforms/react-native/entry.test.ts
 * instead: importing it needs that suite's RN module harness, which a plain node test
 * environment does not provide.
 */
import { describe, expect, it } from 'vitest'

import { validateStakekitActionAddress, validateStakekitActionInput } from '@/index'
import {
  validateStakekitActionAddress as addressFromStakekit,
  validateStakekitActionInput as inputFromStakekit,
} from '@/tools/defi/stakekit'
import {
  validateStakekitActionAddress as addressFromTools,
  validateStakekitActionInput as inputFromTools,
} from '@/tools/index'

describe('StakeKit action validators are exported from the public surfaces (sdk#1902)', () => {
  it('root @/index re-exports the canonical implementations', () => {
    expect(validateStakekitActionAddress).toBe(addressFromStakekit)
    expect(validateStakekitActionInput).toBe(inputFromStakekit)
  })

  it('the tools barrel re-exports the same identities', () => {
    expect(addressFromTools).toBe(addressFromStakekit)
    expect(inputFromTools).toBe(inputFromStakekit)
  })

  // A consumer's reason for wanting these: the preflight rules must agree with what the
  // builders enforce. Spot-check the contract through the PUBLIC surface so an export
  // that accidentally pointed at a different function would be caught by behaviour too.
  it('the exported validators behave as the preflight contract documents', () => {
    expect(validateStakekitActionAddress(`0x${'ab'.repeat(20)}`)).toBeNull() // EVM, 40 hex
    expect(validateStakekitActionAddress(`0x${'ab'.repeat(32)}`)).toBeNull() // Sui, 64 hex
    // A 0x-prefixed value of any other length is refused locally rather than forwarded
    // to yield.xyz as an opaque 4xx.
    expect(validateStakekitActionAddress('0xdeadbeef')).toMatch(/Invalid 0x-prefixed address/)
    // Non-0x families pass through — yield.xyz validates them server-side.
    expect(validateStakekitActionAddress('cosmos1abcdef')).toBeNull()

    expect(validateStakekitActionInput(`0x${'ab'.repeat(20)}`, '1.5')).toBeNull()
    expect(validateStakekitActionInput('0xdeadbeef', '1.5')).toMatch(/Invalid 0x-prefixed address/)
  })
})
