---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

Allow native swaps whose source is the protocol's own chain (RUNE on THORChain, CACAO on MayaChain) past the broadcast guard: those routes are MsgDeposits with no inbound vault and never appear in /inbound_addresses, so the inbound-existence and vault-address checks are skipped for them while quote-expiry and trading-halt checks still run.
