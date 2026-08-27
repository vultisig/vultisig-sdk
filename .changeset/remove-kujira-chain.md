---
'@vultisig/core-chain': major
'@vultisig/core-mpc': major
'@vultisig/sdk': major
'@vultisig/rujira': major
---

Remove Kujira (KUJI) chain support. Kujira wound down in 2025 and every RPC/LCD endpoint the SDK shipped for it is now dead (the polkachu hosts no longer resolve; publicnode 404s), so balances, sends, swaps, staking and governance on Kujira cannot function.

`Chain.Kujira` / `CosmosChain.Kujira` are removed from the chain union, along with the Kujira entries in the chain registry, cosmos RPC/LCD/fee/gas/memo tables, SwapKit + Skip + native-swap routing, the Kujira token list, IBC chain-id mapping, governance config and address derivation.

The `chains/cosmos/thor/kujira-merge` module is intentionally **kept**: it describes the six Kujira-origin tokens (KUJI, rKUJI, FUZN, NSTK, WINK, LVN) that migrated onto THORChain as `thor.*` secured assets, plus their IBC representations on Cosmos Hub and Osmosis. Those assets are unaffected and keep resolving.

Consumers holding a persisted `Chain.Kujira` value must drop it — the symbol no longer type-checks.
