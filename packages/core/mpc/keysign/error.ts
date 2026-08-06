export type BuildKeysignPayloadErrorType =
  | 'not-enough-funds'
  | 'ripple-destination-tag-invalid'
  | 'ripple-destination-tag-required'

export class BuildKeysignPayloadError extends Error {
  constructor(
    public readonly type: BuildKeysignPayloadErrorType,
    message: string = type
  ) {
    super(message)
    this.name = 'BuildKeysignPayloadError'
  }
}
