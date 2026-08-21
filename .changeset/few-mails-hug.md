---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Export `resolveSourceChannelByDestChain` from the supported SDK root and prep surfaces so first-party IBC consumers can reuse the canonical reverse route lookup instead of rebuilding the route index locally.
