---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Keep the SDK IBC route table in sync with first-party consumers by adding the direct `cosmoshub-4` → `noble-1` channel-536 path to `prepareIbcTransfer()` and route discovery.
