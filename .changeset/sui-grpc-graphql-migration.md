---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': minor
'@vultisig/sdk': minor
'@vultisig/cli': patch
---

Move every Sui read, simulation and broadcast off JSON-RPC.

Sui is retiring JSON-RPC: shutdown on Foundation mainnet full nodes began the
week of 2026-07-27 and full decommission (code removal) lands mid-October 2026,
after which no provider can serve it. This is a scheduled migration ahead of
that date, NOT a fix for a live outage — as of 2026-07-27 both
`sui-rpc.publicnode.com` and `fullnode.mainnet.sui.io` still answer JSON-RPC.

- `getSuiClient()` now returns a `SuiGrpcClient` pointed at
  `https://fullnode.mainnet.sui.io:443` (gRPC-web over HTTPS).
- React Native uses `SuiGraphQLClient` against
  `https://graphql.mainnet.sui.io/graphql` instead: grpc-web needs
  `Response.body` streaming, which Hermes' fetch does not provide. Both clients
  implement the same unified transport interface, so callsites are identical.
- Balance, coin metadata, coin listing, tx hash, tx status, broadcast and
  keysign gas refinement moved to `getBalance` / `getCoinMetadata` / `listCoins`
  / `simulateTransaction` / `getTransaction` / `executeTransaction`.
- The dependency-free `@vultisig/sdk` balance tools (`getSuiBalance`,
  `getSuiTokenBalance`, `getSuiAllBalances`) now POST Sui GraphQL and follow the
  paginated `balances` connection to completion, returning `tokens_unavailable`
  rather than a silently truncated portfolio.

Broadcast-error classification follows the transport. A gRPC failure carries the
grpc-status NAME in `code` (not a JSON-RPC number) and a percent-encoded message,
so both classifiers were re-pointed:

- `isTransientBroadcastError` retries `UNAVAILABLE` / `DEADLINE_EXCEEDED` /
  `RESOURCE_EXHAUSTED` and decodes the message before pattern-matching. A
  grpc-web response is HTTP 200 with the real status in the trailer, so the
  existing 5xx branch never saw a busy or restarting node.
- The CLI's permanent-vs-retryable gate matches `INVALID_ARGUMENT` instead of
  the numeric `-32002`. Left unchanged, that gate would have gone dead and every
  permanent Sui rejection would have been re-broadcast as if transient.

Breaking for direct consumers: `assertSuiTxSucceeded` now takes the unified
client's transaction result (`{ $kind, Transaction | FailedTransaction }`)
instead of a JSON-RPC effects object.
