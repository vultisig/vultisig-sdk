// Typed state errors (vultisig-sdk sdkcli2-13 P1-6 / P7a-2).
//
// Regression guards:
//  - "No active vault" threw a plain Error, so `balance -o json` on an empty store
//    exited 7/UNKNOWN_ERROR with no hint — indistinguishable from a real crash.
//  - A readable pointer naming a vault whose data file is corrupt propagated the raw
//    storage failure ("Failed to read value for key X") as UNKNOWN_ERROR/7, with no
//    remediation path.
// Both now carry stable codes and recovery hints. Corruption is detected positively
// (a JSON.parse SyntaxError cause) so transient IO/permission failures are NOT
// mislabelled unrecoverable.
import { StorageError, StorageErrorCode } from '@vultisig/sdk'
import { describe, expect, it } from 'vitest'

import { classifyError, CorruptStateError, ExitCode, NoActiveVaultError, toErrorJson, UnknownError } from './errors'

describe('NoActiveVaultError', () => {
  it('is NO_ACTIVE_VAULT / exit 15, not UNKNOWN / 7', () => {
    const err = new NoActiveVaultError()
    expect(err.code).toBe('NO_ACTIVE_VAULT')
    expect(err.exitCode).toBe(ExitCode.NO_ACTIVE_VAULT)
    expect(err.exitCode).not.toBe(ExitCode.UNKNOWN)
  })

  it('is not retryable and carries an actionable recovery path', () => {
    const err = new NoActiveVaultError()
    expect(err.retryable).toBe(false)
    expect(err.hint).toBeTruthy()
    expect(err.suggestions).toEqual(expect.arrayContaining(['vultisig switch <id>', 'vultisig create']))
  })

  it('survives classifyError unchanged and serialises the hint into the JSON envelope', () => {
    const json = toErrorJson(classifyError(new NoActiveVaultError()))
    expect(json.success).toBe(false)
    expect(json.error.code).toBe('NO_ACTIVE_VAULT')
    expect(json.error.exitCode).toBe(15)
    expect(json.error.retryable).toBe(false)
    expect(json.error.hint).toBeTruthy()
    expect(json.error.suggestions?.length).toBeGreaterThan(0)
  })
})

describe('CorruptStateError classification', () => {
  // What the node storage backend actually throws for an unparseable file.
  function storageParseFailure(key = 'activeVaultId') {
    return new StorageError(
      StorageErrorCode.Unknown,
      `Failed to read value for key "${key}"`,
      new SyntaxError('Unexpected end of JSON input')
    )
  }

  it('maps an unparseable stored value to CORRUPT_STATE / exit 16', () => {
    const classified = classifyError(storageParseFailure())
    expect(classified).toBeInstanceOf(CorruptStateError)
    expect(classified.code).toBe('CORRUPT_STATE')
    expect(classified.exitCode).toBe(ExitCode.CORRUPT_STATE)
  })

  it('offers a re-import recovery path instead of a bare storage message', () => {
    const classified = classifyError(storageParseFailure())
    expect(classified.hint).toBeTruthy()
    expect(classified.suggestions?.some(s => s.includes('import'))).toBe(true)
    expect(classified.retryable).toBe(false)
  })

  it('names the offending storage key in the error context', () => {
    const classified = classifyError(storageParseFailure('vault-abc123'))
    expect(classified.context).toMatchObject({ key: 'vault-abc123' })
  })

  it('does NOT label a permission/IO storage failure as corrupt — retrying those can work', () => {
    const ioFailure = new StorageError(
      StorageErrorCode.Unknown,
      'Failed to read value for key "activeVaultId"',
      Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    )
    expect(classifyError(ioFailure)).not.toBeInstanceOf(CorruptStateError)
  })

  it('does NOT label a StorageError with no cause as corrupt', () => {
    const bare = new StorageError(StorageErrorCode.Unknown, 'Failed to read value for key "activeVaultId"')
    const classified = classifyError(bare)
    expect(classified).not.toBeInstanceOf(CorruptStateError)
    expect(classified).toBeInstanceOf(UnknownError)
  })
})
