import { describe, expect, it, vi } from 'vitest'

import type { CommandContext } from '../core'
import { ExitCode, InvalidInputError } from '../core/errors'
import {
  executeCreateFast,
  executeCreateFromSeedphraseFast,
  executeVerify,
  validateFastVaultCreateInputs,
} from './vault-management'

// Controls what the shared prompt chokepoint (../lib/prompt) resolves to, so the
// `verify --resend` prompted/mixed path can be exercised without a real inquirer
// prompt rendering during tests.
const promptMock = vi.fn()
vi.mock('../lib/prompt', () => ({
  prompt: (...args: unknown[]) => promptMock(...args),
}))

// bead vultisig-33sz9: `create fast` previously accepted --email 'notemail',
// --password '1', and --name '' and provisioned real server-side vault state
// for each. validateFastVaultCreateInputs catches all three client-side.
describe('validateFastVaultCreateInputs (bead 33sz9)', () => {
  const validBase = { name: 'MyVault', email: 'me@example.com', password: 'longenough' }

  it('accepts valid inputs (no throw)', () => {
    expect(() => validateFastVaultCreateInputs(validBase)).not.toThrow()
  })

  it('accepts email with subdomain + plus-tag', () => {
    expect(() => validateFastVaultCreateInputs({ ...validBase, email: 'me+tag@sub.example.co.uk' })).not.toThrow()
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
    for (const email of [
      'notemail',
      'no@dot',
      '@example.com',
      'no space@example.com',
      'foo@',
      'a@example..com',
      '.a@example.com',
      'a.@example.com',
      'a@-example.com',
      'a@example-.com',
    ]) {
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

  it('counts user-perceived password characters, not UTF-16 code units', () => {
    expect(() => validateFastVaultCreateInputs({ ...validBase, password: '😀😀😀😀' })).toThrow(/password too short/i)
    expect(() => validateFastVaultCreateInputs({ ...validBase, password: '😀😀😀😀abcd' })).not.toThrow()
  })

  it('counts user-perceived password characters, not unicode code points (ZWJ sequences)', () => {
    // '👩🏽‍❤️‍💋‍👨' is 1 grapheme cluster (a "kiss" family emoji) but 9 code points —
    // code-point counting would let a single-character password through.
    expect(() => validateFastVaultCreateInputs({ ...validBase, password: '👩🏽‍❤️‍💋‍👨' })).toThrow(
      /password too short/i
    )
    // 4 family emoji = 4 grapheme clusters, still below the 8-char minimum.
    expect(() => validateFastVaultCreateInputs({ ...validBase, password: '👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦' })).toThrow(/password too short/i)
  })

  it('returns normalized email for callers that send the value upstream', () => {
    expect(validateFastVaultCreateInputs({ ...validBase, email: '  me@example.com  ' }).email).toBe('me@example.com')
  })

  it('executeCreateFast passes the normalized name and email upstream', async () => {
    const createFastVault = vi.fn().mockResolvedValue('vault-id-123')
    const ctx = { sdk: { createFastVault }, dispose: () => {} } as unknown as CommandContext

    await executeCreateFast(ctx, {
      name: '  MyVault  ',
      password: 'password1',
      email: '  me@example.com  ',
      twoStep: true,
    })

    // Asserts both fields (not just email) so a revert of the `:177` name trim is caught too.
    expect(createFastVault).toHaveBeenCalledWith(expect.objectContaining({ name: 'MyVault', email: 'me@example.com' }))
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

  // PR #1749 review (neavra) minor item: --two-step + invalid input was untested.
  it('rejects invalid input in --two-step mode too, before any server call', async () => {
    const createFastVault = vi.fn().mockResolvedValue('vault-id-123')
    const ctx = { sdk: { createFastVault }, dispose: () => {} } as unknown as CommandContext

    await expect(
      executeCreateFast(ctx, { name: 'MyVault', password: 'x', email: 'me@example.com', twoStep: true })
    ).rejects.toBeInstanceOf(InvalidInputError)
    expect(createFastVault).not.toHaveBeenCalled()
  })
})

// PR #1749 review (neavra, should-fix 3): the only test through
// executeCreateFromSeedphraseFast used valid inputs and exited at requireInteractive
// before ever reaching invalid-input territory — deleting the
// validateFastVaultCreateInputs(...) call at the top of this function left the whole
// suite green. This pins the call site directly: an invalid password must reject
// before validateSeedphrase (or anything else on ctx.sdk) is ever touched.
describe('executeCreateFromSeedphraseFast validates inputs before touching ctx (PR #1749 should-fix 3)', () => {
  it('rejects a too-short password before validateSeedphrase is called', async () => {
    const validateSeedphrase = vi.fn()
    const ctx = { sdk: { validateSeedphrase }, dispose: () => {} } as unknown as CommandContext

    await expect(
      executeCreateFromSeedphraseFast(ctx, {
        mnemonic: 'abandon '.repeat(11) + 'about',
        name: 'v',
        password: 'x',
        email: 'e@x.io',
      })
    ).rejects.toThrow(/password/i)

    expect(validateSeedphrase).not.toHaveBeenCalled()
  })
})

// PR #1749 review (neavra, should-fix 5): executeVerify's post-prompt re-validation
// (the `requireNonEmptyEmailForResend`/`requireNonEmptyPasswordForResend` calls after
// the prompt block) was only exercised on the both-flags-supplied path. These cover
// the prompted/mixed path — one field via flag, the other from the (mocked) prompt.
describe('executeVerify --resend prompted/mixed path (PR #1749 should-fix 5)', () => {
  it('re-validates a prompted-for email the same as a flag-supplied one, then completes the OTP step', async () => {
    promptMock
      .mockResolvedValueOnce({ email: 'prompted@vault.io' }) // the missing-email prompt
      .mockResolvedValueOnce({ code: '123456' }) // the follow-up OTP-code prompt

    const resendVaultVerification = vi.fn().mockResolvedValue(undefined)
    const vault = { id: 'vault-id', name: 'V', chains: [], on: vi.fn() }
    const verifyVault = vi.fn().mockResolvedValue(vault)
    const setActiveVault = vi.fn().mockResolvedValue(undefined)
    const ctx = {
      sdk: { resendVaultVerification, verifyVault },
      setActiveVault,
      dispose: () => {},
    } as unknown as CommandContext

    // Password supplied via flag; email is missing so it comes from the mocked prompt.
    const result = await executeVerify(ctx, 'vault-id', { resend: true, password: 'password123' })

    expect(result).toBe(true)
    expect(resendVaultVerification).toHaveBeenCalledWith({
      vaultId: 'vault-id',
      email: 'prompted@vault.io',
      password: 'password123',
    })
  })

  it('rejects an empty prompted-for password via the same post-prompt re-validation as flags', async () => {
    promptMock.mockResolvedValueOnce({ password: '' }) // the missing-password prompt answers empty

    const resendVaultVerification = vi.fn().mockResolvedValue(undefined)
    const ctx = {
      sdk: { resendVaultVerification },
      dispose: () => {},
    } as unknown as CommandContext

    await expect(executeVerify(ctx, 'vault-id', { resend: true, email: 'e@x.io' })).rejects.toBeInstanceOf(
      InvalidInputError
    )
    expect(resendVaultVerification).not.toHaveBeenCalled()
  })
})
