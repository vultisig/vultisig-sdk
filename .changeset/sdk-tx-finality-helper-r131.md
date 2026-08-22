---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Add a public `pollTxStatusUntilFinal` helper to `@vultisig/sdk` and reuse it across SDK/CLI transaction finality polling paths.
