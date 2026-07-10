---
'@vultisig/sdk': patch
---

fix(polkadot): hash-verify "temporarily banned" broadcasts instead of assuming success

The Polkadot broadcast resolver treated a Substrate `temporarily banned` pool
error as an idempotent success (peer-race duplicate) and returned without ever
consulting `verifyBroadcastByHash`. Substrate bans a tx hash for a cool-off
window whenever it is *removed* from the pool, which covers both a benign
already-processed duplicate AND a genuine rejection (an invalid/dropped
extrinsic banned to stop retry spam) — the string alone cannot tell them apart.
Swallowing it therefore risked reporting a genuinely-rejected transaction as
confirmed (a fund-safety false positive), unlike `bittensor.ts` which only
fast-paths the unambiguous "Already Imported".

`temporarily banned` is removed from the idempotent fast-path list; it now flows
through `verifyBroadcastByHash`, which swallows the error only when the tx hash
is actually observed on chain / in the pool and otherwise surfaces the real
failure. `already imported` / `already known` (unambiguous duplicates) keep their
fast-path.
