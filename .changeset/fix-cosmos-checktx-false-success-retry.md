---
'@vultisig/sdk': patch
---

Fix a Cosmos broadcast false-success bug: `isTransientBroadcastError` now treats cosmjs's `BroadcastTxError` (a genuine CheckTx-stage node rejection) as terminal instead of classifying it via message-regex. Previously, a CheckTx rejection whose chain-controlled `log` text happened to read as transient (e.g. an ante-handler error saying "aborted" or "timed out") would get retried, and the resend's "tx already exists in cache" response would be swallowed as a false success — even though the original transaction never reached the mempool.
