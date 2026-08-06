---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Store CLI-managed token IDs as bare lowercase EVM contract addresses, retain reads of legacy chain-prefixed IDs, and use stable ecosystem token names in discovery. Token removal now emits the standard JSON success envelope and token-add help documents its required name.
