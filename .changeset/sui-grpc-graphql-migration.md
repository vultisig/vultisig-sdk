---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': minor
'@vultisig/sdk': minor
---

Move every Sui read, simulation and broadcast off JSON-RPC.

Sui disabled JSON-RPC on Foundation mainnet full nodes the week of 2026-07-27
and decommissions it entirely by mid-October 2026, so the previous
`SuiJsonRpcClient` against `sui-rpc.publicnode.com` was on a dead rail.

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

Breaking for direct consumers: `assertSuiTxSucceeded` now takes the unified
client's transaction result (`{ $kind, Transaction | FailedTransaction }`)
instead of a JSON-RPC effects object.
