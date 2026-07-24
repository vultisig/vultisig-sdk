---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Replace React-Native-exported balance helpers' direct `AbortSignal.timeout()` usage with the SDK's Hermes-safe fetch timeout wrapper so balance reads keep working on runtimes that do not provide that API.
