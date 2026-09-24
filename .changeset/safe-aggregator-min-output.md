---
"@vultisig/sdk": patch
---

Check known 1inch, Kyber, and same-chain LI.FI router minimum-output parameters against the requested slippage immediately before EVM keysign payload construction. Kyber partial fills enforce a proportional floor for the amount spent. Unsupported selectors and LI.FI bridge routes remain available but rely on the aggregator trust boundary.
