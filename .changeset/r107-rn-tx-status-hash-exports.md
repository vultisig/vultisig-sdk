---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Export `getTxStatus` and `isValidTxHash` from the React Native SDK entrypoint so mobile consumers can reuse the canonical transaction status and hash-validation helpers without deep imports or local copies.
