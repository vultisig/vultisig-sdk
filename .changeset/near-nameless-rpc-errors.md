---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

NEAR: a missing account or transaction reported without nearcore's structured error name (as the default `api.vultisig.com/near/` RPC does) is now read from nearcore's whole not-found message, so an unfunded account's balance reads 0 and a send to a named account that does not exist fails with `near-destination-not-found` instead of `NEAR query failed (UNKNOWN_ERROR)`. Structured names still win. NEAR transaction status now asks with `wait_until: NONE`, so an unknown hash is reported as `not_found` at once instead of the lookup timing out.
