---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Fix React Native `getCoinBalance()` so Ripple balances use the RN-safe fetch path instead of the websocket `xrpl` client.
