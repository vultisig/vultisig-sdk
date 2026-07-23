---
'@vultisig/sdk': patch
---

Export the canonical StakeKit / yield helper family from the React Native entrypoint so RN consumers can use the same SDK-owned builders, parsers, scan-request helpers, and validators without deep-importing the internal module path.
