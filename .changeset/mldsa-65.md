---
"@vultisig/core-mpc": major
"@vultisig/core-chain": major
"@vultisig/sdk": major
"@vultisig/cli": major
---

Use ML-DSA-65 for post-quantum key generation and signing. ML-DSA-44 key shares are no longer supported; generate new post-quantum keys. The serialized vault field keeps its legacy name for wire compatibility.

Align QBTC public-key encoding and address derivation with ML-DSA-65, and use sign mode 1000 for SHA256(SignDoc) verification.
