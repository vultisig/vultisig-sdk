---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

Signing inputs refuse a SwapKit payload whose `fromAmount` (every chain) or EVM `tx.value` is not a plain decimal string within uint256. `BigInt` alone also read `''`, `'0x…'`, `'+1'` and padded strings.
