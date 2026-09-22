---
"@vultisig/sdk": patch
"@vultisig/cli": patch
---

Use the SDK transaction parser to validate approval/main candidates and CLI buffering consistently. Reject malformed pairs, non-EVM pairs, and conflicting transaction chain metadata before buffering while preserving valid leg order and single sends.
