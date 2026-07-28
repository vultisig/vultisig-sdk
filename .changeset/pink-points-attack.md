---
'@vultisig/sdk': minor
'@vultisig/cli': minor
---

Fix tracked token balance fetching and make token removal report the truth.

A token added with `tokens --add` is stored under an id of the form `<Chain>-<address>`. That id was passed to the RPC as if it were a contract address; the RPC rejected it, the throw was swallowed per-chain, and the **whole chain's balances disappeared** — native asset included — leaving only a `console.warn`. Balance lookups now resolve a stored token reference to its real contract address / chain-level asset id before both the per-coin and batched calls. What is written to the vault file is unchanged, and balance result keys still use the stored id.

**Behavior change — `tokens --remove` now fails when nothing was removed.** Removal previously matched on an exact id comparison, so removing by symbol (or by contract address for a token added under the prefixed id form) matched nothing while the command still printed `Removed token …` and exited 0. Removal now goes through the shared token resolver, and a reference that matches no tracked token raises the existing not-found error and exits **5** (`RESOURCE_NOT_FOUND`) instead of exiting 0. A script that removed an untracked token and relied on a zero exit will now see a failure. Removal by symbol and by contract address, which previously silently no-op'd, now work.

**Behavior change — the agent `vault_coin remove` tool reports per-coin outcomes.** It previously returned `removed: true` unconditionally; it now returns the SDK's actual result, so the model is told when a coin was not tracked. Batch removals return `{ chain, tokenId, removed }` per coin rather than `{ chain, tokenId }`.

`VaultBase.removeToken` widens from `Promise<void>` to `Promise<boolean>` — `true` when a tracked token was removed and persisted, `false` when the reference matched nothing. Existing callers that ignore the return value are unaffected.
