---
'@vultisig/sdk': patch
---

Recover ambiguous Cosmos raw broadcasts by re-querying the deterministic tx hash before declaring failure, so transport-response loss no longer invites a blind re-broadcast.