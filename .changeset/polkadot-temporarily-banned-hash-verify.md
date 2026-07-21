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
through `verifyBroadcastByHash`. `already imported` / `already known`
(unambiguous duplicates) keep their fast-path.

Note on current prod behaviour: for Polkadot the confirm branch of
`verifyBroadcastByHash` is effectively inert today — its status lookup hits
Subscan's `assethub-polkadot.api.subscan.io` endpoint, which requires an API key
this codebase does not send, so the request 403s and the original error is
always re-thrown. The net shipped effect of this change is therefore to make
`temporarily banned` **fail closed** (surfaced as a failure) rather than be
assumed a success — the fund-safe direction. Restoring true
confirm-and-swallow of benign peer-race duplicates requires authenticated
Subscan tx-status and is tracked as a separate follow-up (vultisig-sdk#1145).
