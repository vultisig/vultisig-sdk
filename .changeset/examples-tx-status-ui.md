---
'@vultisig/sdk': patch
---

feat(examples): add transaction confirmation polling to example UI

Adds `getTxStatus` support to the browser and electron example apps with non-blocking
background polling after broadcast. The success banner shows immediately after broadcast
with a "Confirming..." spinner, then updates to "Transaction Confirmed!" (with fee) or
"Transaction failed on-chain" when the poll resolves.

Also fixes:
- Missing `MaxSendAmountResult` re-export from shared package
- `@cosmjs/proto-signing` not externalized in SDK rollup config (caused runtime crash in browser)
