/**
 * Walk a CBOR data item starting at `offset` and return the offset
 * immediately after the item ends. This allows extracting raw byte
 * ranges from CBOR without re-encoding.
 *
 * Supports: unsigned/negative ints, byte/text strings, arrays, maps, tags,
 * and simple values (true/false/null). Does NOT support indefinite-length.
 *
 * Every read is bounds-checked so a truncated / malformed CBOR input fails
 * fast with a descriptive error instead of silently returning bogus offsets.
 */
export const cborSkip = (data: Uint8Array, offset: number): number => {
  if (!Number.isInteger(offset) || offset < 0 || offset >= data.length) {
    throw new Error(
      `cborSkip: offset ${offset} is out of bounds (data length ${data.length})`
    )
  }
  const initial = data[offset]
  const majorType = initial >> 5
  const additional = initial & 0x1f

  const { value, nextOffset } = readArgument(data, offset, additional)

  // Major type 0/1: unsigned/negative integer — head only
  if (majorType <= 1) return nextOffset

  // Major type 2/3: byte/text string — head + N bytes
  if (majorType <= 3) {
    const end = nextOffset + Number(value)
    if (end > data.length) {
      throw new Error(
        `cborSkip: truncated string at offset ${offset} (need ${Number(value)} bytes, have ${data.length - nextOffset})`
      )
    }
    return end
  }

  // Major type 4: array — head + N items
  if (majorType === 4) {
    let pos = nextOffset
    for (let i = 0; i < Number(value); i++) {
      pos = cborSkip(data, pos)
    }
    return pos
  }

  // Major type 5: map — head + N key-value pairs
  if (majorType === 5) {
    let pos = nextOffset
    for (let i = 0; i < Number(value); i++) {
      pos = cborSkip(data, pos) // key
      pos = cborSkip(data, pos) // value
    }
    return pos
  }

  // Major type 6: tag — head + 1 nested item
  if (majorType === 6) return cborSkip(data, nextOffset)

  // Major type 7: simple values / floats
  if (additional <= 23) return nextOffset          // simple value in head
  if (additional === 24) return nextOffset          // 1-byte simple
  if (additional === 25) return nextOffset          // float16 (2 bytes in arg)
  if (additional === 26) return nextOffset          // float32 (4 bytes in arg)
  if (additional === 27) return nextOffset          // float64 (8 bytes in arg)

  throw new Error(`Unsupported CBOR item at offset ${offset}: initial byte 0x${initial.toString(16)}`)
}

/** Read the argument value and return the offset after the argument. */
const readArgument = (
  data: Uint8Array,
  offset: number,
  additional: number
): { value: bigint; nextOffset: number } => {
  const ensureBytes = (needed: number) => {
    const end = offset + 1 + needed
    if (end > data.length) {
      throw new Error(
        `cborSkip/readArgument: truncated CBOR head at offset ${offset} (need ${needed} argument bytes, have ${data.length - offset - 1})`
      )
    }
  }

  if (additional < 24) return { value: BigInt(additional), nextOffset: offset + 1 }
  if (additional === 24) {
    ensureBytes(1)
    return { value: BigInt(data[offset + 1]), nextOffset: offset + 2 }
  }
  if (additional === 25) {
    ensureBytes(2)
    const v = (data[offset + 1] << 8) | data[offset + 2]
    return { value: BigInt(v), nextOffset: offset + 3 }
  }
  if (additional === 26) {
    ensureBytes(4)
    const v =
      (data[offset + 1] << 24) |
      (data[offset + 2] << 16) |
      (data[offset + 3] << 8) |
      data[offset + 4]
    return { value: BigInt(v >>> 0), nextOffset: offset + 5 }
  }
  if (additional === 27) {
    ensureBytes(8)
    const hi =
      (data[offset + 1] << 24) |
      (data[offset + 2] << 16) |
      (data[offset + 3] << 8) |
      data[offset + 4]
    const lo =
      (data[offset + 5] << 24) |
      (data[offset + 6] << 16) |
      (data[offset + 7] << 8) |
      data[offset + 8]
    return {
      value: (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0),
      nextOffset: offset + 9,
    }
  }
  throw new Error(`Unsupported CBOR additional info ${additional}`)
}
