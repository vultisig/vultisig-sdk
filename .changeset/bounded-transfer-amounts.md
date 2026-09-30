---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

Reject malformed and oversized Sui, Tron, Ripple and Cardano transfer amounts before signing-input construction instead of silently wrapping them through Long conversion. Preserve the full unsigned 64-bit amount range for Sui and Cardano and existing serialization for valid amounts.
