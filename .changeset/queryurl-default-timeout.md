---
'@vultisig/lib-utils': patch
'@vultisig/sdk': patch
---

Add a 20s default deadline to `queryUrl` (the shared HTTP helper behind
prices/balances/swap quotes/broadcast/MPC-server calls). An unbounded `fetch`
against a hung upstream previously wedged the caller forever — a stalled
`/coingeicko` price proxy made `fiatToAmount -> execute_send` hang and
perma-loaded the agent send card's "Network fee" row until the app's own 60s
build-timeout fired. The deadline is implemented with a Hermes-compatible
`AbortController` + `setTimeout` and only applies when the caller passes no
`signal`; callers that supply their own `signal` keep owning cancellation. A
new `timeoutMs` option lets callers override the default.
