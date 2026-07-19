---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

Expose the native-swap expiry and inbound-vault guard from core MPC so shipping
wallets and the SDK facade can share one pre-signing or pre-broadcast check.
