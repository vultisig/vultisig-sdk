---
'@vultisig/core-chain': patch
'@vultisig/rujira': patch
---

Migrate THORChain Midgard, THORNode REST, and Tendermint RPC endpoints from the legacy `*.thorchain.network` hosts to the Liquify gateway (`gateway.liquify.com/chain/thorchain_midgard`, `…/thorchain_api`, `…/thorchain_rpc`). Updated `cosmosRpcUrl.THORChain`, `tendermintRpcUrl.THORChain`, `thorchainMidgardBaseUrl`, and the rujira `MAINNET_CONFIG` endpoints accordingly.

In `RujiraDiscovery.discoverViaChain()`, replaced the brittle `rpc → thornode` string substitution with a direct read of `MAINNET_CONFIG.restEndpoint`. Under the new gateway routing the substitution silently produced an invalid host (`thorchain_thornode`) and the fallback branch was unreachable. Removed the now-unused `rpcEndpoint` option from `DiscoveryOptions` and the corresponding plumbing in `RujiraClient`.
