---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Re-export `prepareThorchainMsgDepositTxFromKeys` and its params type from the SDK root surface so downstream signers can consume the canonical THOR/Maya MsgDeposit prep helper instead of maintaining local shims.
