---
'@vultisig/sdk': patch
---

Narrow `acrossQuote`'s `sourceChain` parameter type to the literal `'Ethereum'` instead of the full `AcrossChain` union, so the public contract truthfully reflects that only Ethereum-origin routes are supported today (the runtime already rejected every other origin). Fixed the misleading `@example` that showed a non-Ethereum `sourceChain`.
