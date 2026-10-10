---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': minor
---

`BuildKeysignPayloadError('not-enough-funds')` can carry a `shortfall` (`BuildKeysignPayloadShortfall`: `required`, `available`, `ticker`, `decimals`, `includesNetworkCosts`) so apps can name the missing asset and amount. `core-chain` exports `getSendRetainedBalance`, the balance a native send must keep back, shared with `getMaxSendableAmount`.
