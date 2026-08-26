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
  // dkls23-rs embeds the sender's keyshare-assigned party_id (fixed at keygen time),
  // not their index in the *current* signing session's device order. `partyId` below
  // is resolved against this call's `[localPartyId, ...peers]` order as a best effort:
  // it's correct for 2-of-2 FastVault (keygen and signing always use the same 2
  // devices), but is NOT reliable for N-of-M SecureVault, where a later signing
  // session can involve a different subset/order of devices than keygen did. Treat
  // `partyId` as a hint, not a guarantee, until it's resolved from the vault's
  // original keygen party order (see vault.signers) instead.
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
