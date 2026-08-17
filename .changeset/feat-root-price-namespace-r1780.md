---
'@vultisig/sdk': patch
---

Add a grouped `sdk.price` namespace handle at the root `@vultisig/sdk` entry (`price.getPrice`, `price.getPricesBatch`, etc.), matching the ergonomics of `sdk.gas.*`, `sdk.defi.*`, `sdk.token.*`, and `sdk.cosmos.*`. The flat named price exports (`getPrice`, `getPricesBatch`, ...) are unchanged for backward compatibility.
