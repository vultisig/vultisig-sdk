---
'@vultisig/sdk': minor
---

feat(sdk): add `sdk.balance.cosmos` (`getCosmosBalance`) — a read-only Cosmos bank-denom balance primitive. Fetches `cosmos/bank/v1beta1/balances/<address>` over LCD (with a Polkachu fallback mirror), decimal-scales the native denom and known/curated denoms via BigInt (no precision loss), and resolves IBC vouchers with decimals pinned from a safe table — emitting unresolvable `ibc/`/`factory/` denoms in raw base units with a `(base units)` caveat so downstream pricing never mis-scales. Exposed from both the default and react-native entry points.
