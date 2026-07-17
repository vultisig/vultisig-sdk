// `verify` emits one JSON envelope, and `vaults` surfaces pending vaults
// (vultisig-sdk sdkcli2-13 P2-7).
//
// Regression guards:
//  - A failed `verify ... -o json` wrote a success-shaped {verified:false} envelope
//    AND THEN threw, so the caller emitted a second {success:false} envelope. stdout
//    carried two JSON documents and JSON.parse(output) threw.
//  - The failure message parroted SDK jargon ("...with createFastVault()").
//  - Two-step vaults awaiting verification appeared nowhere in `vaults`: only the
//    create-time output named the id, so an agent that lost it could not resume.
import { StorageError, StorageErrorCode, VaultError, VaultErrorCode } from '@vultisig/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { withExit } from '../../adapters/cli-runner'
import type { CommandContext } from '../../core'
import {
  type AuthRequiredError,
  CorruptStateError,
  ExitCode,
  type ExternalServiceError,
  InvalidInputError,
  VaultNotFoundError,
} from '../../core/errors'
import { configureOutput, resetOutput } from '../../lib/output'
import { executeVaults, executeVerify } from '../vault-management'

let stdout: string[]
let writeSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  stdout = []
  writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
    stdout.push(String(chunk))
    return true
  })
})

afterEach(() => {
  writeSpy.mockRestore()
  vi.restoreAllMocks()
  resetOutput()
})

const jsonOut = () => stdout.join('')

describe('verify failure output', () => {
  function makeCtx(err: Error): CommandContext {
    return {
      sdk: { verifyVault: vi.fn().mockRejectedValue(err) },
      setActiveVault: vi.fn(async () => {}),
      dispose: () => {},
    } as unknown as CommandContext
  }

  it('writes NO envelope of its own on failure — the caller emits exactly one', async () => {
    configureOutput({ format: 'json' })

    await expect(executeVerify(makeCtx(new Error('Invalid code')), 'v1', { code: '000000' })).rejects.toThrow()

    // Previously this wrote a success-shaped {"success":true,...,"verified":false}.
    expect(jsonOut()).toBe('')
  })

  it('throws instead of returning false, so stdout can never carry two documents', async () => {
    configureOutput({ format: 'json' })

    const result = await executeVerify(makeCtx(new Error('Invalid code')), 'v1', { code: '000000' }).then(
      () => 'resolved',
      () => 'threw'
    )

    expect(result).toBe('threw')
  })

  it('does not leak SDK jargon for a missing pending vault, and points at CLI commands', async () => {
    const sdkErr = new Error('No pending vault found for this ID. Create a vault first with createFastVault().')

    await executeVerify(makeCtx(sdkErr), 'v-missing', { code: '000000' }).then(
      () => {
        throw new Error('expected executeVerify to throw')
      },
      (err: unknown) => {
        expect(err).toBeInstanceOf(VaultNotFoundError)
        const e = err as VaultNotFoundError
        expect(e.message).not.toMatch(/createFastVault/)
        expect(e.message).toContain('v-missing')
        expect(e.suggestions).toEqual(expect.arrayContaining(['vultisig vaults']))
      }
    )
  })

  it('suggests --resend for a wrong or expired code', async () => {
    await executeVerify(makeCtx(new Error('Invalid code')), 'v1', { code: '000000' }).then(
      () => {
        throw new Error('expected executeVerify to throw')
      },
      (err: unknown) => {
        expect((err as VaultNotFoundError).suggestions).toEqual(expect.arrayContaining(['vultisig verify v1 --resend']))
      }
    )
  })
})

describe('verify --resend failure', () => {
  // A resend that failed must not look like one that succeeded. When executeVerify
  // stopped signalling failure via `return false`, this path kept returning false —
  // and the caller no longer converts that into an error, so a rate-limited or
  // bad-password resend reported exit 0 with empty stdout in JSON mode.
  function makeCtx(err: Error): CommandContext {
    return {
      sdk: { resendVaultVerification: vi.fn().mockRejectedValue(err) },
      dispose: () => {},
    } as unknown as CommandContext
  }

  const resendOpts = { resend: true, email: 'e@x.io', password: 'password123' }

  it('throws rather than resolving, so a failed resend is not reported as success', async () => {
    const outcome = await executeVerify(makeCtx(new Error('rate limited')), 'v1', resendOpts).then(
      r => `resolved:${r}`,
      () => 'threw'
    )

    expect(outcome).toBe('threw')
  })

  it('writes no success envelope for an email that was never sent', async () => {
    configureOutput({ format: 'json' })

    await expect(executeVerify(makeCtx(new Error('rate limited')), 'v1', resendOpts)).rejects.toThrow()

    expect(jsonOut()).toBe('')
  })

  it('classifies an unrecognised resend failure as retryable, hinting at rate limiting', async () => {
    await executeVerify(makeCtx(new Error('rate limited')), 'v1', resendOpts).then(
      () => {
        throw new Error('expected executeVerify to throw')
      },
      (err: unknown) => {
        const e = err as ExternalServiceError
        expect(e.code).toBe('EXTERNAL_SERVICE')
        expect(e.retryable).toBe(true)
        expect(e.hint).toMatch(/rate-limit/i)
      }
    )
  })

  it('keeps the SDK classification when it is already precise (bad password -> auth)', async () => {
    const authErr = new VaultError(VaultErrorCode.InvalidConfig, 'Failed to unlock vault: invalid password')

    await executeVerify(makeCtx(authErr), 'v1', resendOpts).then(
      () => {
        throw new Error('expected executeVerify to throw')
      },
      (err: unknown) => {
        expect((err as AuthRequiredError).code).toBe('AUTH_REQUIRED')
      }
    )
  })
})

describe('vaults pending visibility', () => {
  function makeCtx(pending: string[], vaults: unknown[] = []) {
    return {
      sdk: {
        listVaults: vi.fn(async () => vaults),
        listPendingVaults: vi.fn(async () => pending),
      },
      getActiveVault: () => null,
      dispose: () => {},
    } as unknown as CommandContext
  }

  it('reports pending vault ids and status in the JSON envelope', async () => {
    configureOutput({ format: 'json' })

    await executeVaults(makeCtx(['pending-abc']))

    const parsed = JSON.parse(jsonOut())
    expect(parsed.success).toBe(true)
    expect(parsed.data.pending).toEqual([{ id: 'pending-abc', status: 'pending_verification' }])
  })

  it('emits exactly one parseable JSON document', async () => {
    configureOutput({ format: 'json' })

    await executeVaults(makeCtx(['pending-abc']))

    expect(() => JSON.parse(jsonOut())).not.toThrow()
  })

  it('reports an empty pending list when there are none', async () => {
    configureOutput({ format: 'json' })

    await executeVaults(makeCtx([]))

    expect(JSON.parse(jsonOut()).data.pending).toEqual([])
  })

  it('does not let a pending-store read failure take down vaults', async () => {
    configureOutput({ format: 'json' })
    const ctx = makeCtx([])
    ;(ctx.sdk.listPendingVaults as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('storage exploded'))

    await expect(executeVaults(ctx)).resolves.toBeDefined()
    expect(JSON.parse(jsonOut()).data.pending).toEqual([])
  })
})

// executeVerify runs verifyVault() AND setActiveVault() inside one try, so the catch also
// sees failures that happen after the code was accepted. Those must not be reported as a
// bad code: the whole point of the CORRUPT_STATE work is that a broken store says so.
describe('verify failure classification after the code was accepted', () => {
  function ctxWhereActivationFails(err: Error): CommandContext {
    // `on` matters: executeVerify calls setupVaultEvents(vault) between verifyVault()
    // and setActiveVault(), so a vault without it throws a TypeError before the code
    // under test is ever reached.
    const vault = { id: 'v1', name: 'V', chains: [], on: vi.fn() }
    return {
      sdk: { verifyVault: vi.fn().mockResolvedValue(vault) },
      setActiveVault: vi.fn().mockRejectedValue(err),
      dispose: () => {},
    } as unknown as CommandContext
  }

  it('surfaces a corrupt store as CORRUPT_STATE, not "your code is wrong"', async () => {
    const corrupt = new StorageError(
      StorageErrorCode.Unknown,
      'Failed to read value for key "activeVaultId"',
      new SyntaxError('Unexpected end of JSON input')
    )

    const err = await executeVerify(ctxWhereActivationFails(corrupt), 'v1', { code: '123456' }).catch((e: unknown) => e)

    // Was InvalidInputError/4 with "the code may be incorrect or expired" plus a --resend
    // suggestion — advice for a problem the user does not have, since the code was correct.
    expect(err).toBeInstanceOf(CorruptStateError)
    expect((err as CorruptStateError).exitCode).toBe(ExitCode.CORRUPT_STATE)
  })

  it('still treats a genuinely rejected code as InvalidInputError / exit 4', async () => {
    const ctx = {
      sdk: { verifyVault: vi.fn().mockRejectedValue(new Error('Invalid code')) },
      setActiveVault: vi.fn(async () => {}),
      dispose: () => {},
    } as unknown as CommandContext

    const err = await executeVerify(ctx, 'v1', { code: '000000' }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(InvalidInputError)
    expect((err as InvalidInputError).exitCode).toBe(ExitCode.INVALID_INPUT)
  })
})

// The single-envelope claim is about what the CLI actually WRITES, which is withExit's job.
// Asserting only that executeVerify throws leaves the count unproven: the old two-document
// bug lived in the seam between the two.
describe('verify through the real withExit wrapper', () => {
  it('writes exactly one parseable JSON document and exits with the typed code', async () => {
    configureOutput({ format: 'json' })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('__exit__')
    }) as never)

    const ctx = {
      sdk: { verifyVault: vi.fn().mockRejectedValue(new Error('Invalid code')) },
      setActiveVault: vi.fn(async () => {}),
      dispose: () => {},
    } as unknown as CommandContext

    await expect(
      withExit(async () => {
        await executeVerify(ctx, 'v1', { code: '000000' })
      })()
    ).rejects.toThrow('__exit__')

    const out = jsonOut()
    expect(() => JSON.parse(out)).not.toThrow()
    expect(out.trim().split(/\}\s*\{/).length).toBe(1)
    expect(JSON.parse(out).success).toBe(false)
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.INVALID_INPUT)
  })
})
