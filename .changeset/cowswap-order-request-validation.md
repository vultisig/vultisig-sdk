---
'@vultisig/sdk': patch
---

fix(swap): validate CowSwap order fields against the request before signing (AGG-01). sellToken/buyToken/kind/partiallyFillable were taken straight from the untrusted CoW /quote response and signed as-is via the EIP-712 GPv2 Order struct — a compromised/buggy response could substitute a token address or flip kind from 'sell' to 'buy' (inverting GPv2's sell/buy semantics while the SDK's grossSellAmount math still assumes sell-order semantics), and the SDK would sign it. Now asserts each field matches what was actually requested and refuses to build a signable order on any mismatch.
