---
'@vultisig/core-chain': patch
---

Reject a non-zero `tx.value` from a 1inch quote for a token-source swap. 1inch's `tx.value` flows through from the untrusted quote response verbatim (unlike Kyber, which constructs `value` itself), so a compromised/buggy response could set a non-zero value on a token→token swap and move native gas-coin the user never authorized alongside the swap. A token-source swap pulls the sell token via ERC-20 allowance, so `value` must be `0`; native-source swaps (where `value` is legitimately the sell amount) are unaffected.
