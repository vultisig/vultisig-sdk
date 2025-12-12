---
"@vultisig/sdk": patch
---

fix(node): add globalThis.crypto polyfill for WASM MPC libraries

The WASM MPC libraries (DKLS, Schnorr) use `crypto.getRandomValues()` internally via wasm-bindgen. Node.js 18+ has webcrypto but it's not on `globalThis` by default, causing "unreachable" errors during MPC signing. This adds the polyfill before any WASM initialization.
