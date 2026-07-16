---
'@vultisig/cli': patch
---

Classify agent errors that occur after a transaction broadcast as a non-retryable partial success, preserving transaction hashes and original diagnostics while warning callers not to blindly retry.
