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

const dklsAbortAndBanPartyMinCode = 100
const dklsAbortAndBanPartyMaxCode = 109

export class DklsMaliciousPartyError extends Error {
  constructor(public readonly code: number) {
    super(`DKLS keysign aborted because party ${code - dklsAbortAndBanPartyMinCode + 1} was detected as malicious`)
    this.name = 'DklsMaliciousPartyError'
  }
}

export const isDklsAbortAndBanPartyCode = (code: number) =>
  Number.isInteger(code) && code >= dklsAbortAndBanPartyMinCode && code <= dklsAbortAndBanPartyMaxCode

export const getDklsAbortAndBanPartyCode = (error: unknown): number | undefined => {
  if (typeof error === 'number') {
    return isDklsAbortAndBanPartyCode(error) ? error : undefined
  }

  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'number') {
    return isDklsAbortAndBanPartyCode(error.code) ? error.code : undefined
  }

  const message = error instanceof Error ? error.message : String(error)
  const code = Number(
    message.match(/\b(?:code:\s*|error code\s+)(\d+)\b/)?.[1] ??
      message.match(/\bLIB_ABORT_PROTOCOL_AND_BAN_PARTY_(\d+)\b/)?.[1]
  )

  if (Number.isInteger(code) && code >= 1 && code <= 10 && message.includes('LIB_ABORT_PROTOCOL_AND_BAN_PARTY_')) {
    return dklsAbortAndBanPartyMinCode + code - 1
  }

  return isDklsAbortAndBanPartyCode(code) ? code : undefined
}
