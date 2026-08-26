---
'@vultisig/cli': patch
---

The aggregate `balance` and `portfolio` views now say they only cover the vault's enabled chains. When the enabled set is a strict subset of the SDK-supported chains, the human output appends a hint pointing at `vultisig balance <chain>` and `vultisig chains --add <chain>`, and JSON mode carries the same text in a dedicated `scopeHint` field (omitted when every supported chain is enabled). The balances/portfolio payloads and the scoped `balance <chain>` path are unchanged.
