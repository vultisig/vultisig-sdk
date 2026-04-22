---
'@vultisig/rujira': major
---

feat(rujira)!: drop RujiraPerps

**BREAKING CHANGE.** The `RujiraPerps` module is removed. Its only
consumer was vultisig-mcp-ts' `src/tools/rujira/perps.ts`, which
[mcp-ts#36](https://github.com/vultisig/mcp-ts/pull/36) deleted
(commit `e5ecb58`). No known external consumers.

Removed:

- `RujiraPerps` class export
- `PerpsMarket` type export
- `PerpsTransactionParams` type export
- `client.perps` field on `RujiraClient`
- `@vultisig/rujira/perps` subpath export

No replacement API. Consumers that still need perps-style interactions
should open an issue — the module was a thin wrapper around on-chain
calls that can be reconstructed if there's demand.

All other Rujira surfaces (swap, orderbook, staking, ghost, deposit,
withdraw, discovery) are unchanged.
