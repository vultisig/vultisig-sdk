import base58 from 'bs58'

export type SolanaRawTxEncoding = 'auto' | 'base58' | 'base64'

type BufferLike = {
  from: (input: string, encoding: 'base64') => Uint8Array
}

const decodeBase64 = (value: string): Uint8Array => {
  const buffer = (globalThis as unknown as { Buffer?: BufferLike }).Buffer
  if (buffer?.from) {
    return new Uint8Array(buffer.from(value, 'base64'))
  }

  const decode = (globalThis as unknown as { atob?: (input: string) => string }).atob
  if (!decode) {
    throw new Error('no base64 decoder available (install the `buffer` polyfill)')
  }

  const binary = decode(value)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

/** Decode a signed Solana transaction without importing `@solana/web3.js`. */
export const decodeSolanaRawTx = (rawTx: string, encoding: SolanaRawTxEncoding = 'auto'): Uint8Array => {
  const resolvedEncoding =
    encoding === 'auto' ? (rawTx.includes('=') || /[+/]/.test(rawTx) ? 'base64' : 'base58') : encoding

  return resolvedEncoding === 'base64' ? decodeBase64(rawTx) : base58.decode(rawTx)
}

/**
 * Derive the transaction id from the first signature in a serialized Solana
 * transaction. This pure parser is shared by the regular SDK raw-broadcast
 * service and the Hermes-safe React Native adapter so both surfaces verify the
 * same transaction identity.
 */
export const deriveSolanaRawTxSignature = (rawTx: string, encoding: SolanaRawTxEncoding = 'auto'): string => {
  const txBytes = decodeSolanaRawTx(rawTx, encoding)
  let offset = 0
  let signatureCount = 0
  let shift = 0
  let terminated = false

  while (offset < txBytes.length && shift <= 14) {
    const byte = txBytes[offset]!
    signatureCount |= (byte & 0x7f) << shift
    offset += 1

    if ((byte & 0x80) === 0) {
      terminated = true
      break
    }

    shift += 7
  }

  const signaturesEnd = offset + signatureCount * 64
  if (!terminated || signatureCount < 1 || txBytes.length < signaturesEnd) {
    throw new Error('Solana raw transaction does not contain a complete primary signature')
  }

  return base58.encode(txBytes.subarray(offset, offset + 64))
}
