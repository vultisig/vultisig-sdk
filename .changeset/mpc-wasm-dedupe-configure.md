---
'@vultisig/mpc-types': patch
'@vultisig/mpc-wasm': patch
'@vultisig/sdk': patch
---

Treat a second `WasmMpcEngine` `configureMpc` registration as a no-op when bundlers evaluate the platform entry in multiple chunks (Chrome extension / Vite), preventing dev-time throws and broken signing.
