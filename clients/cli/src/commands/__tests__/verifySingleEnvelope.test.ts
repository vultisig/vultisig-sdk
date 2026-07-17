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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CommandContext } from '../../core'
import { VaultNotFoundError } from '../../core/errors'
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
