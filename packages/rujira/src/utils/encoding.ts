/**
 * Cross-platform encoding helpers (Node.js + browser)
 * @module utils/encoding
 */

const hasBuffer = typeof globalThis.Buffer !== 'undefined';

/** Encode a UTF-8 string to base64. */
export function base64Encode(input: string): string {
  if (hasBuffer) {
    return globalThis.Buffer.from(input).toString('base64');
  }
  return btoa(
    Array.from(new TextEncoder().encode(input), (b) => String.fromCharCode(b)).join('')
  );
}

/** Decode a base64 string to UTF-8. */
export function base64Decode(input: string): string {
  if (hasBuffer) {
    return globalThis.Buffer.from(input, 'base64').toString();
  }
  return new TextDecoder().decode(
    Uint8Array.from(atob(input), (c) => c.charCodeAt(0))
  );
}

/** Encode a Uint8Array to a hex string (no 0x prefix). */
export function hexEncode(bytes: Uint8Array): string {
  if (hasBuffer) {
    return globalThis.Buffer.from(bytes).toString('hex');
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Decode a hex string (with or without 0x prefix) to Uint8Array. */
export function hexDecode(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return bytes;
}

/** Encode a Uint8Array to base64. */
export function bytesToBase64(bytes: Uint8Array): string {
  if (hasBuffer) {
    return globalThis.Buffer.from(bytes).toString('base64');
  }
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
}

/** Encode a UTF-8 string to Uint8Array. */
export function stringToBytes(str: string): Uint8Array {
  if (hasBuffer) {
    return new Uint8Array(globalThis.Buffer.from(str));
  }
  return new TextEncoder().encode(str);
}
