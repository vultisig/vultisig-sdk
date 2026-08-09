import { hashTypedData } from 'viem'

const secp256k1Order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n

function normalizeTypedDataTypes(
  types: Record<string, Array<{ name: string; type: string }>>
): Record<string, Array<{ name: string; type: string }>> {
  const messageTypes = { ...types }
  delete messageTypes.EIP712Domain
  return messageTypes
}

/**
 * Coerce an EIP-712 `domain.chainId` value from number / bigint / decimal / hex
 * string into the exact numeric form `hashTypedData()` expects.
 */
export function coerceEip712ChainId(raw: unknown): number | bigint {
  if (typeof raw === 'number' || typeof raw === 'bigint') return raw

  const text = String(raw).trim()
  if (text === '') {
    throw new Error('EIP-712 domain.chainId is empty')
  }

  if (/^[0-9]+$/.test(text) || /^0x[0-9a-fA-F]+$/.test(text)) {
    const bigintValue = BigInt(text)
    return bigintValue <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(bigintValue) : bigintValue
  }

  throw new Error(`EIP-712 domain.chainId not parseable: ${String(raw)}`)
}

/**
 * Compute the canonical EIP-712 digest for a typed-data payload.
 *
 * Normalizes a string `domain.chainId` to a numeric value so the hash matches
 * ethers / on-chain domain separator expectations, and strips an explicit
 * `EIP712Domain` entry because viem synthesizes it from `domain` directly.
 */
export function computeEip712Hash(
  domain: Record<string, unknown>,
  types: Record<string, Array<{ name: string; type: string }>>,
  primaryType: string,
  message: Record<string, unknown>
): string {
  const normalizedDomain =
    domain.chainId !== undefined ? { ...domain, chainId: coerceEip712ChainId(domain.chainId) } : domain

  return hashTypedData({
    domain: normalizedDomain,
    types: normalizeTypedDataTypes(types),
    primaryType,
    message,
  } as Parameters<typeof hashTypedData>[0])
}

function parseDERSignature(sigHex: string): { r: string; s: string } {
  const raw = sigHex.startsWith('0x') ? sigHex.slice(2) : sigHex

  if (raw.length === 128) {
    return { r: raw.slice(0, 64), s: raw.slice(64) }
  }

  let offset = 0
  if (raw.slice(offset, offset + 2) !== '30') {
    throw new Error('EIP-712 signature must be DER or 64-byte raw r||s hex')
  }
  offset += 2
  const totalLen = Number.parseInt(raw.slice(offset, offset + 2), 16)
  offset += 2
  if (totalLen * 2 !== raw.length - 4) {
    throw new Error('Malformed DER signature: length mismatch')
  }

  if (raw.slice(offset, offset + 2) !== '02') {
    throw new Error('Malformed DER signature: missing r INTEGER')
  }
  offset += 2
  const rLen = Number.parseInt(raw.slice(offset, offset + 2), 16)
  offset += 2
  const r = raw.slice(offset, offset + rLen * 2)
  offset += rLen * 2

  if (raw.slice(offset, offset + 2) !== '02') {
    throw new Error('Malformed DER signature: missing s INTEGER')
  }
  offset += 2
  const sLen = Number.parseInt(raw.slice(offset, offset + 2), 16)
  offset += 2
  const s = raw.slice(offset, offset + sLen * 2)

  return {
    r: r.padStart(64, '0').slice(-64),
    s: s.padStart(64, '0').slice(-64),
  }
}

/**
 * Canonicalize a raw MPC secp256k1 signature for EVM use by folding a high-S
 * value into the lower half of the curve order and flipping recovery parity.
 */
export function toCanonicalEvmSignature(sigHex: string, recovery: number): { r: string; s: string; recovery: number } {
  const { r, s } = parseDERSignature(sigHex)
  const sBig = BigInt(`0x${s}`)
  if (sBig > secp256k1Order >> 1n) {
    const folded = secp256k1Order - sBig
    return { r, s: folded.toString(16).padStart(64, '0'), recovery: recovery ^ 1 }
  }

  return { r, s, recovery }
}
