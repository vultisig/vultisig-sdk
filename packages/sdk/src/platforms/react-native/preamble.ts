/**
 * React Native preamble — side-effect module that installs runtime polyfills
 * the SDK's RN bundle depends on.
 *
 * CONSUMERS MUST IMPORT THIS AS THE FIRST STATEMENT in their app entry
 * (above any other import), e.g.:
 *
 *     // index.ts / index.tsx
 *     import '@vultisig/sdk/rn-preamble'
 *     // ...all other imports follow
 *
 * Why a dedicated module and not inlined into the RN entry:
 * Metro (and Babel's CJS transform) hoist `require()` calls to the top of the
 * module wrapper. Polyfill code written "at the top" of the RN entry runs
 * *after* the SDK's own transitive imports evaluate — too late for any chain
 * library (@ton/core, bs58check, @bufbuild/protobuf, xrpl, …) that touches
 * `Buffer` at module-init. Loading this file first ensures its body runs
 * completely before any other require returns.
 */
import { Buffer } from 'buffer'

// 1. Install globalThis.Buffer.
//    Use the existing global Buffer if a consumer set one before us; fall back
//    to our imported polyfill. Patch the chosen instance so all transitive
//    consumers reading globalThis.Buffer see the repaired prototype.
const globalWithBuffer = globalThis as { Buffer?: typeof Buffer }
const RuntimeBuffer = globalWithBuffer.Buffer ?? Buffer
globalWithBuffer.Buffer = RuntimeBuffer

// 2. Repair Buffer.prototype.subarray.
//    The RN `buffer` polyfill returns a plain Uint8Array from subarray, which
//    strips Buffer methods like `.copy()`. Node's native Buffer preserves
//    them. @ton/core (and likely others) call `.copy()` on subarray results.
//    Wrap the view as a real Buffer sharing the same memory so Node-shaped
//    assumptions downstream keep working.
const originalSubarray = RuntimeBuffer.prototype.subarray
RuntimeBuffer.prototype.subarray = function patchedSubarray(this: Buffer, start?: number, end?: number) {
  const view = originalSubarray.call(this, start, end)
  return RuntimeBuffer.from(view.buffer, view.byteOffset, view.byteLength)
}
