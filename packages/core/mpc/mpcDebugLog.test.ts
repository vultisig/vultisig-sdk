import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

import { afterEach, describe, expect, it, vi } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))

describe('mpcDebugLog', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.VULTISIG_DEBUG
  })

  it('writes to stderr (console.error), never stdout (console.log), when VULTISIG_DEBUG is set', async () => {
    process.env.VULTISIG_DEBUG = '1'
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { mpcDebugLog } = await import('./mpcDebugLog')
    mpcDebugLog('session id:', 'abc-123')

    expect(errorSpy).toHaveBeenCalledWith('session id:', 'abc-123')
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('is silent when VULTISIG_DEBUG is unset', async () => {
    delete process.env.VULTISIG_DEBUG
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { mpcDebugLog } = await import('./mpcDebugLog')
    mpcDebugLog('outbound message:', { body: new Uint8Array([1, 2, 3]) })

    expect(errorSpy).not.toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalled()
  })
})

// Regression guard for sdk-cli keygen STDOUT spew: the keygen/reshare/key-import
// ceremonies must never write tracing to STDOUT, or the CLI's `-o json` output
// (a single JSON envelope on stdout) is corrupted and MPC internals leak into
// CI logs. Tracing goes through mpcDebugLog -> stderr instead.
describe('mpc keygen paths keep STDOUT clean', () => {
  const keygenSources = ['dkls/dkls.ts', 'schnorr/schnorrKeygen.ts', 'mldsa/mldsaKeygen.ts']

  it.each(keygenSources)('%s contains no stdout console.log', relPath => {
    const source = readFileSync(join(here, relPath), 'utf8')
    expect(source).not.toMatch(/console\.log\s*\(/)
  })
})
