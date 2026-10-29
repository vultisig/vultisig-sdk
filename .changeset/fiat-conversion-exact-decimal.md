---
'@vultisig/sdk': patch
---

`fiatToCrypto` and `cryptoToFiat` no longer drop a whole unit of the last digit to float error (`cryptoToFiat({ amount: 1.15, price: 100 })` returned `114.99`, now `115`). Both now compute on exact decimals and truncate the exact result, so it never exceeds the true value; at high `decimals` that can mean more digits than before (`100 / 3` at 18 decimals was `33.333333333333336`, now `33.333333333333333333`). Plain-decimal string inputs are taken digit for digit instead of being rounded through a float.
