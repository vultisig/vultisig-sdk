---
"@vultisig/core-mpc": patch
---

mpc/keygen: support multi-namespace DKLS setup messages and propagate `is_tss_batch` so parallel batched keygen interops with Android (uses default namespace) and iOS (uses `p-ecdsa`/`p-eddsa` after iOS PR #4246). `DKLS.prepareKeygenSetup` now accepts a list of mirror `message_id` namespaces — initiator writes to all, joiner races a poll across them and back-fills the rest. `DKLS.startReshareWithRetry` accepts a `setupMessageId` so reshare's setup matches per-protocol exchange channels. Regenerated `KeygenMessage` and `ReshareMessage` protos pick up the upstream `is_tss_batch` field.
