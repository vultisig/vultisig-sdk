/**
 * Hermes-safe replacements for the @ton/crypto-primitives functions the
 * SDK's TON bridge needs at build-time.
 *
 * Context: `@ton/crypto-primitives` ships three entry points selected via
 * the `browser` / `react-native` / `main` fields in its package.json:
 *   - main (node.js):  uses Node `crypto` (WASM-heavy on RN via metro's
 *                      shim chain, and not actually available under Hermes).
 *   - browser.js:      uses `crypto.subtle.digest` — NOT available under
 *                      Hermes, so evaluating this file at module load
 *                      throws immediately.
 *   - native.js:       uses `jssha` — Hermes-safe but still pulls extra
 *                      weight the SDK does not need.
 *
 * The SDK's TON tx builder only needs pure-JS SHA-256. We expose it from
 * `@noble/hashes` (already an SDK dep) and use this shim instead of
 * reaching into `@ton/crypto-primitives` at all. That keeps the RN bundle
 * deterministic across metro versions and avoids any accidental pull of
 * `crypto.subtle` if the resolution order is overridden.
 */
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js'

/** SHA-256 over a Uint8Array or UTF-8 string. Returns a raw 32-byte digest. */
export function sha256(source: Uint8Array | string): Uint8Array {
  if (typeof source === 'string') {
    return nobleSha256(new TextEncoder().encode(source))
  }
  return nobleSha256(source)
}
