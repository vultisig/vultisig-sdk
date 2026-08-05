import { describe, expect, it } from 'vitest'

import { ExitCode, InvalidInputError } from '../core/errors'
import { validateFastVaultCreateInputs } from './vault-management'

// bead vultisig-33sz9: `create fast` previously accepted --email 'notemail',
// --password '1', and --name '' and provisioned real server-side vault state
// for each. validateFastVaultCreateInputs catches all three client-side.
describe('validateFastVaultCreateInputs (bead 33sz9)', () => {
  const validBase = { name: 'MyVault', email: 'me@example.com', password: 'longenough' }

  it('accepts valid inputs (no throw)', () => {
    expect(() => validateFastVaultCreateInputs(validBase)).not.toThrow()
  })

  it('accepts email with subdomain + plus-tag', () => {
    expect(() =>
      validateFastVaultCreateInputs({ ...validBase, email: 'me+tag@sub.example.co.uk' })
    ).not.toThrow()
  })

  it('rejects empty name', () => {
    for (const name of ['', '   ', undefined]) {
      try {
        validateFastVaultCreateInputs({ ...validBase, name: name as string })
        throw new Error(`expected reject for name="${name}"`)
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidInputError)
        expect((err as InvalidInputError).exitCode).toBe(ExitCode.INVALID_INPUT)
        expect((err as InvalidInputError).message).toMatch(/name/i)
      }
    }
  })

  it('rejects empty email', () => {
    for (const email of ['', '   ', undefined]) {
      try {
        validateFastVaultCreateInputs({ ...validBase, email: email as string })
        throw new Error(`expected reject for email="${email}"`)
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidInputError)
        expect((err as InvalidInputError).message).toMatch(/email/i)
      }
    }
  })

  it('rejects syntactically invalid email (bead 33sz9 canonical case)', () => {
    for (const email of ['notemail', 'no@dot', '@example.com', 'no space@example.com', 'foo@']) {
      try {
        validateFastVaultCreateInputs({ ...validBase, email })
        throw new Error(`expected reject for email="${email}"`)
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidInputError)
        expect((err as InvalidInputError).message).toMatch(/does not look valid/i)
      }
    }
  })

  it('rejects password shorter than 8 chars (bead 33sz9)', () => {
    for (const password of ['', '1', 'abc', 'seven!!']) {
      try {
        validateFastVaultCreateInputs({ ...validBase, password })
        throw new Error(`expected reject for password of length ${password.length}`)
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidInputError)
        expect((err as InvalidInputError).message).toMatch(/password too short/i)
      }
    }
  })

  it('accepts password exactly 8 chars (boundary)', () => {
    expect(() => validateFastVaultCreateInputs({ ...validBase, password: 'exactly8' })).not.toThrow()
  })

  it('checks name → email → password in that order (deterministic diagnostic)', () => {
    // Both name and email are bad — the name error should fire first because it
    // is the first check. Users get one specific issue at a time instead of a
    // conflated multi-field failure.
    try {
      validateFastVaultCreateInputs({ name: '', email: 'bad', password: 'x' })
      throw new Error('expected reject')
    } catch (err) {
      expect((err as InvalidInputError).message).toMatch(/name/i)
    }
    // Fix name → email is next
    try {
      validateFastVaultCreateInputs({ name: 'ok', email: 'bad', password: 'x' })
      throw new Error('expected reject')
    } catch (err) {
      expect((err as InvalidInputError).message).toMatch(/email/i)
    }
    // Fix email → password is next
    try {
      validateFastVaultCreateInputs({ name: 'ok', email: 'ok@example.com', password: 'x' })
      throw new Error('expected reject')
    } catch (err) {
      expect((err as InvalidInputError).message).toMatch(/password/i)
    }
  })
})
