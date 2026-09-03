---
'@vultisig/cli': patch
'@vultisig/sdk': patch
---

Refresh EIP-1559 priority fees immediately before CLI signing so zero-tip transactions use the live RPC suggestion, respect canonical per-chain minimums, and never exceed `maxFeePerGas`. Broadcast rejection messages now retain the actionable RPC reason without exposing the signed raw transaction.
