---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

Reject 1inch, KyberSwap, and LI.FI EVM swap calldata at keysign-build time unless its decoded on-chain minimum output satisfies the quote's requested slippage bound.
