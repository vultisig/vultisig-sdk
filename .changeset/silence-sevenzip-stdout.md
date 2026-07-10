---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

Silence 7z-wasm banner/progress output on stdout during QR payload compression/decompression. The chatter polluted the machine-output channel for CLI consumers (e.g. corrupting piped/JSON output on `join secure`); errors still surface via stderr.
