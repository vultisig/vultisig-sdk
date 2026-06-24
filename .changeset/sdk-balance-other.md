---
'@vultisig/sdk': minor
---

feat(sdk): add `sdk.balance.<chain>` read-only balance fetchers for non-EVM /
non-Cosmos chains (XRP, TRON, TON, Sui, Cardano, Bittensor/TAO) plus token
variants (TRC-20, TON jetton, Sui token), ported from mcp-ts. Pure crypto —
decode RPC responses, parse base units, format, validate address format.
Read-only; nothing here signs or broadcasts.
