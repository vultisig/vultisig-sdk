---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Export `recipientSanity` and its helper family from `@vultisig/sdk/react-native` so mobile consumers can import the canonical null/self-send/malformed-EVM recipient guard instead of maintaining local copies.
