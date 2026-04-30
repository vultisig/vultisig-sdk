---
'@vultisig/sdk': patch
'@vultisig/lib-utils': patch
---

Build shared workspace packages before bundling the SDK (`yarn build:sdk`). The browser example prepare step now rebuilds shared `dist` outputs when missing or stale, and shared utilities now import `Buffer` explicitly so browser apps do not crash during module evaluation.
