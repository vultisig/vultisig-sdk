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

  // A disabling-looking value must disable, not enable: any non-empty string is
  // truthy in JS, so a loose `if (process.env.VULTISIG_DEBUG)` gate would treat
  // `VULTISIG_DEBUG=0` as "on". The `=== '1'` gate keeps it off.
  it.each(['0', 'false', 'off'])('stays silent when VULTISIG_DEBUG=%s (not "1")', async value => {
    process.env.VULTISIG_DEBUG = value
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { mpcDebugLog } = await import('./mpcDebugLog')
    mpcDebugLog('session id:', 'abc-123')

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

  // Cover the whole class of stdout sinks, not just console.log: console.info /
  // console.debug also route to stdout in Node, and process.stdout.write is the
  // low-level escape hatch. Any of them would re-corrupt the `-o json` stream.
  const stdoutSinks = /console\.(log|info|debug)\s*\(|process\.stdout\.write\s*\(/

  it.each(keygenSources)('%s writes no tracing to stdout', relPath => {
    const source = readFileSync(join(here, relPath), 'utf8')
    expect(source).not.toMatch(stdoutSinks)
  })
})
