---
"@vultisig/sdk": minor
"@vultisig/rujira": patch
---

Require real pre-fetched Cosmos account metadata when `skipChainSpecificFetch` is true. SignAmino requires decimal uint64 `accountNumber` and `sequence` options; SignDirect requires a `sequence` option and retains its input account number. Missing or invalid metadata now throws `VaultError(INVALID_CONFIG)` instead of returning a payload with zero defaults. Explicit zero and large uint64 values remain exact. Online fetching is unchanged.

Forward the already-fetched withdrawal sequence from Rujira into SDK preparation while retaining the final withdrawal payload behavior.
