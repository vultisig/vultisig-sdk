---
'@vultisig/sdk': patch
---

fix(swap): reject a limit-swap LIM that floors to zero (THOR-02). A tiny target price could floor the computed limit amount to 0, and THORChain treats a zero trade target as an unprotected MARKET swap with no minimum-output floor — silently discarding the price protection the user configured for their limit order. Fail closed with a clear error instead of building a memo that reinterprets as a market swap.
