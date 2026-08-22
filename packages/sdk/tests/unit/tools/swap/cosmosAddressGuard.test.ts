import { describe, expect, it } from 'vitest'

import { assertNotValidatorHrp, validatorRoleForHrp } from '@/tools/swap/skip/cosmosAddressGuard'

describe('validatorRoleForHrp', () => {
  it('classifies operator and consensus HRPs, and null for plain accounts', () => {
    // sdk#1969: this is the single canonical classifier — cosmosStaking.ts and
    // ibcTransfer.ts import it instead of keeping their own copies.
    expect(validatorRoleForHrp('cosmosvaloper')).toBe('operator')
    expect(validatorRoleForHrp('cosmosvalcons')).toBe('consensus')
    expect(validatorRoleForHrp('cosmos')).toBeNull()
    expect(validatorRoleForHrp('osmo')).toBeNull()
  })

  it('is case-insensitive', () => {
    expect(validatorRoleForHrp('COSMOSVALOPER')).toBe('operator')
  })
})

describe('assertNotValidatorHrp', () => {
  it('throws for a validator operator HRP', () => {
    expect(() => assertNotValidatorHrp('cosmosvaloper', 'recipient')).toThrow(/OPERATOR/)
  })

  it('throws for a validator consensus HRP', () => {
    expect(() => assertNotValidatorHrp('cosmosvalcons', 'recipient')).toThrow(/CONSENSUS/)
  })

  it('does not throw for a plain account HRP', () => {
    expect(() => assertNotValidatorHrp('cosmos', 'recipient')).not.toThrow()
  })
})
