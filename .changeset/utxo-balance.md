---
'@vultisig/sdk': minor
---

feat(sdk): add `sdk.balance.utxo` — UTXO native balance reads

New vault-free read primitive `getUtxoBalance(chain, address, options?)` for
Bitcoin, Litecoin, Dogecoin, Bitcoin-Cash, and Dash via the Blockchair
dashboards API (defaults to the Vultisig proxy). Returns base-unit satoshis
(string, no float precision loss), a fixed-8-decimal human balance, and the
chain ticker. Also exports `formatUtxoBalance` and `supportedUtxoBalanceChains`.

Ported from mcp-ts `get_utxo_balance` (0 SDK imports) as part of the
mcp-ts/backend -> SDK code-as-action consolidation.
