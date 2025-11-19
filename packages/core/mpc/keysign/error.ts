type BuildKeysignPayloadErrorType = 'not-enough-funds' | 'invalid-address'

export class BuildKeysignPayloadError extends Error {
  constructor(public readonly type: BuildKeysignPayloadErrorType) {
    super(type)
  }
}
