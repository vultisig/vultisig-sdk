---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

Document the existing TON first-send expiry exception for V4R2 and W5 wallets and add signed-output regression coverage for native, Jetton, and dApp transfers. Sequence-zero messages encode `0xffffffff` instead of the requested deadline; signing behavior is unchanged.
