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
  // 1-based index into the setup message's party order (devices: [localPartyId, ...peers]);
  // only the initiating device knows that order, see keysign()'s `partyId` resolution.
  public readonly partyIndex: number
  public partyId?: string

  constructor(public readonly code: number) {
    const partyIndex = code - dklsAbortAndBanPartyMinCode + 1
    super(`DKLS keysign aborted because party ${partyIndex} was detected as malicious`)
    this.name = 'DklsMaliciousPartyError'
    this.partyIndex = partyIndex
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

  const symbolicMatch = message.match(/\bLIB_ABORT_PROTOCOL_AND_BAN_PARTY_(\d+)\b/)
  if (symbolicMatch) {
    const code = dklsAbortAndBanPartyMinCode + Number(symbolicMatch[1]) - 1
    return isDklsAbortAndBanPartyCode(code) ? code : undefined
  }

  // vs-wasm's SignSession throws this Rust `SignError` display string (0-based party id)
  // from both inputMessage() and finish() — go-dkls's equivalent code is 100 + id.
  const wasmMatch = message.match(/\bban the party ID (\d+)\b/)
  if (wasmMatch) {
    const code = dklsAbortAndBanPartyMinCode + Number(wasmMatch[1])
    return isDklsAbortAndBanPartyCode(code) ? code : undefined
  }

  // Native mobile bridge shapes: Android "... failed (code: 103)", iOS "... failed with error code 103".
  const nativeMatch = message.match(/failed \(code:\s*(\d+)\)/) ?? message.match(/failed with error code\s+(\d+)\b/)
  if (nativeMatch) {
    const code = Number(nativeMatch[1])
    return isDklsAbortAndBanPartyCode(code) ? code : undefined
  }

  return undefined
}
