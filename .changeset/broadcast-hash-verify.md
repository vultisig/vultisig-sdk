---
'@vultisig/core-chain': patch
---

fix(chain): hash-verify broadcast errors on all chains

In MPC keysign every participating device broadcasts the same signed
transaction. When a peer wins the RPC race, the slower device gets an
"already known / duplicate / in mempool" error — the tx is on-chain, but
fragile per-chain error-string matching made the slower device fail the
signing flow anyway.

Broadcast resolvers now share a `verifyBroadcastByHash` safety net: on
any broadcast error, re-hash the signed output and check `getTxStatus`;
if the tx is pending or confirmed, swallow the error. Existing string
matches stay as a fast path to avoid an extra RPC roundtrip on the
common case. The five resolvers that previously had no duplicate
detection at all (Solana, Tron, Sui, Ripple, Polkadot) now tolerate
duplicate broadcasts; Polkadot additionally surfaces JSON-RPC errors
that were previously silently ignored.
