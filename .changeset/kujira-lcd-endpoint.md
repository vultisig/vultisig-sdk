---
"@vultisig/core-chain": patch
---

fix(cosmos): use polkachu for the Kujira LCD + RPC endpoints

`kujira-rest.publicnode.com` and `kujira-rpc.publicnode.com` both now return
HTTP 403 "unsupported platform" for our clients, breaking Kujira balance reads
and tx broadcasts. Point `cosmosRpcUrl` and `tendermintRpcUrl` for Kujira at
polkachu (the same provider Noble uses, and the one `getCosmosAccountInfo`
already falls back to). Live-verified 200 with the real ukuji balance.
