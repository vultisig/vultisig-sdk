---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Replace React-Native-exported balance helpers' direct `AbortSignal.timeout()` usage with the SDK's Hermes-safe fetch timeout wrapper so balance reads keep working on runtimes that do not provide that API.

Fixed (review): `withFetchTimeout` clears its deadline once its `consume` callback settles, and the initial port left the response body read OUTSIDE `consume` in all three call sites (`balance/rpc.ts`, `balance/cosmos.ts`, `balance/utxoBalance.ts`) — so a server that sent 200 + headers and then stalled mid-body ran with no deadline at all, despite the caller believing it had one. Moved every body read inside `consume`. Also dropped the new `FetchTimeoutError` from `rpc.ts`'s retry-eligible error set — it had flipped deterministic timeouts from fail-fast to retried (up to 4x the configured timeout stacked before the caller sees anything), contradicting the file's own "deterministic timeouts do not retry" comment on the flaky-mobile path where that matters most.
