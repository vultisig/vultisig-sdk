---
"@vultisig/sdk": patch
---

fix(sui): paginate `getAllCoins` so sends see every coin object. The keysign resolver read only the first ~50-object page, truncating the coin set used for gas + input selection and producing a broken send on wallets with >50 coin objects.
