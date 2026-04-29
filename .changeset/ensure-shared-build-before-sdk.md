---
'@vultisig/sdk': patch
---

Build shared workspace packages before bundling the SDK (`yarn build:sdk`). The browser example prepare step now rebuilds shared `dist` outputs when missing or stale, fixing Rollup ENOENT for `mpc-wasm/dist` on clean checkouts and in containers.
