// Minimal protobuf encoder used by both cosmos staking prep (tools/prep/cosmosStaking.ts)
// and the RN cosmos tx builder (platforms/react-native/chains/cosmos/tx.ts).
// Wire types 0 (varint) and 2 (length-delimited) only.

export function varint(n: number): Uint8Array {
  // `>>>=` operates on 32-bit unsigned ints; anything above 2^32-1 silently
  // wraps and would emit a varint that decodes to a different number. Every
  // call here is a field tag (<= 2^7) or a length prefix (<= Uint8Array.length),
  // but we guard the boundary so a future caller can't silently corrupt the body.
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) {
    throw new Error(`varint: value out of range (got ${n})`)
  }
  const bytes: number[] = []
  while (n > 0x7f) {
    bytes.push((n & 0x7f) | 0x80)
    n >>>= 7
  }
  bytes.push(n & 0x7f)
  return new Uint8Array(bytes)
}

export function field(fieldNum: number, wireType: number, data: Uint8Array): Uint8Array {
  const tag = varint((fieldNum << 3) | wireType)
  if (wireType === 2) {
    const len = varint(data.length)
    const result = new Uint8Array(tag.length + len.length + data.length)
    result.set(tag, 0)
    result.set(len, tag.length)
    result.set(data, tag.length + len.length)
    return result
  }
  const result = new Uint8Array(tag.length + data.length)
  result.set(tag, 0)
  result.set(data, tag.length)
  return result
}

export function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) {
    result.set(a, offset)
    offset += a.length
  }
  return result
}

export function encodeString(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

/** cosmos.base.v1beta1.Coin { string denom = 1; string amount = 2; } */
export function encodeCoin(denom: string, amount: string): Uint8Array {
  return concat(field(1, 2, encodeString(denom)), field(2, 2, encodeString(amount)))
}
