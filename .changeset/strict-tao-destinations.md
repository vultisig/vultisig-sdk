---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Reject invalid TAO transaction destinations before encoding: require a checksummed SS58 address with prefix 42 and a 32-byte account, including for direct transaction-builder calls.
