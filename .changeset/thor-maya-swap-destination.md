---
'@vultisig/sdk': patch
'@vultisig/cli': patch
'@vultisig/core-chain': patch
---

Carry caller-supplied THORChain and MayaChain swap destinations through agent MsgDeposit execution, preserve the existing self-swap default, and reject quote memos that substitute another destination.
