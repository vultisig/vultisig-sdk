const LONG_HEX_PAYLOAD = /(?:0x[0-9a-f]{128,}|\b[0-9a-f]{128,}\b)/giu
const HAS_LONG_HEX_PAYLOAD = /(?:0x[0-9a-f]{128,}|\b[0-9a-f]{128,}\b)/iu
const CUSTOM_INSPECT = Symbol.for('nodejs.util.inspect.custom')
const ARRAY_BUFFER_BYTE_LENGTH = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')?.get

type ErrorWithRpcDetails = Error & {
  details?: unknown
  shortMessage?: unknown
}

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined

const hasCustomInspect = (value: object): boolean => {
  const prototypes = new Set<object>()
  let current: object | null = value

  try {
    while (current && !prototypes.has(current)) {
      prototypes.add(current)
      if (Object.getOwnPropertyDescriptor(current, CUSTOM_INSPECT)) return true
      current = Object.getPrototypeOf(current)
    }
    return false
  } catch {
    return true
  }
}

type InspectNestedValue = (value: unknown) => boolean

const getArrayBufferByteLength = (value: object): number | undefined => {
  try {
    return ARRAY_BUFFER_BYTE_LENGTH?.call(value)
  } catch {
    return undefined
  }
}

const inspectMapEntries = (value: object, inspectNested: InspectNestedValue): boolean | undefined => {
  let unsafe = false
  try {
    Map.prototype.forEach.call(value, (entry: unknown, key: unknown) => {
      if (inspectNested(key) || inspectNested(entry)) unsafe = true
    })
    return unsafe
  } catch {
    return undefined
  }
}

const inspectSetEntries = (value: object, inspectNested: InspectNestedValue): boolean | undefined => {
  let unsafe = false
  try {
    Set.prototype.forEach.call(value, (entry: unknown) => {
      if (inspectNested(entry)) unsafe = true
    })
    return unsafe
  } catch {
    return undefined
  }
}

const hasUnsafeOwnProperties = (value: object, inspectNested: InspectNestedValue): boolean => {
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable) continue
    // Accessors are untrusted and util.inspect may invoke custom inspection;
    // synthesize a fresh Error instead of retaining an opaque object graph.
    if (!('value' in descriptor)) return true
    if (inspectNested(descriptor.value)) return true
  }
  return false
}

const hasUnsafeInspectableValue = (value: unknown, seen: Set<unknown>): boolean => {
  try {
    if (typeof value === 'string') return HAS_LONG_HEX_PAYLOAD.test(value)
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false
    if (seen.has(value)) return false
    seen.add(value)

    if (hasCustomInspect(value)) return true

    const arrayBufferByteLength = getArrayBufferByteLength(value)
    if (arrayBufferByteLength !== undefined) return arrayBufferByteLength >= 64
    if (ArrayBuffer.isView(value)) return value.byteLength >= 64

    const inspectNested = (nested: unknown) => hasUnsafeInspectableValue(nested, seen)
    if (inspectMapEntries(value, inspectNested)) return true
    if (inspectSetEntries(value, inspectNested)) return true

    return hasUnsafeOwnProperties(value, inspectNested)
  } catch {
    // Proxies and foreign-realm host objects can throw while being inspected.
    // Treat opaque graphs as unsafe rather than retaining them in public errors.
    return true
  }
}

/**
 * Keep an RPC rejection actionable without echoing a signed transaction from
 * viem's request diagnostics into terminals or JSON error envelopes.
 */
export const formatBroadcastFailureReason = (cause: unknown): string => {
  if (!(cause instanceof Error)) {
    return String(cause).replace(LONG_HEX_PAYLOAD, '[signed transaction redacted]')
  }

  const rpcError = cause as ErrorWithRpcDetails
  const reason = nonEmptyString(rpcError.details) ?? nonEmptyString(rpcError.shortMessage) ?? cause.message

  return reason.replace(LONG_HEX_PAYLOAD, '[signed transaction redacted]').trim()
}

const buildSafeBroadcastError = (cause: unknown, seen: Set<unknown>): Error => {
  const reason = formatBroadcastFailureReason(cause)
  if (cause instanceof Error && seen.has(cause)) return new Error(reason)
  if (cause instanceof Error) seen.add(cause)

  const hasOwnCause = cause instanceof Error && Object.prototype.hasOwnProperty.call(cause, 'cause')
  if (
    cause instanceof Error &&
    cause.message === reason &&
    !hasOwnCause &&
    !hasUnsafeInspectableValue(cause, new Set())
  ) {
    return cause
  }

  // Do not retain an unsafe error as `.cause`: console.error/util.inspect and
  // structured loggers recursively traverse cause chains even when message and
  // JSON serialization are clean.
  if (hasOwnCause) {
    const descriptor = Object.getOwnPropertyDescriptor(cause, 'cause')
    if (descriptor && 'value' in descriptor && descriptor.value !== undefined) {
      return new Error(reason, { cause: buildSafeBroadcastError(descriptor.value, seen) })
    }
  }

  return new Error(reason)
}

/** Build a diagnostic Error whose entire caller-visible graph is safe to inspect. */
export const toSafeBroadcastError = (cause: unknown): Error => buildSafeBroadcastError(cause, new Set())
