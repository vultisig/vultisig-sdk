---
"@vultisig/core-chain": patch
"@vultisig/sdk": patch
---

Fix TON jetton balances showing a stranger's holdings. Jetton wallet lookups
queried the proxy with `owner_id` + `jetton_master_id`, which toncenter v3
ignores (it filters on `owner_address` + `jetton_address`). The proxy then
returned an unfiltered global list and the code took the first entry — a random
wallet — so an address with no USDT reported ~200M USDT. Restore the correct
params and filter the response by both owner and jetton master instead of
trusting the first entry. This also keeps jetton transfers from resolving the
wrong source wallet.
