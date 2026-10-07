---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': minor
---

NEAR is a SwapKit source chain: a NEAR-Intents `simpleTransfer` quote becomes a plain transfer to the per-swap implicit deposit account, and the NEAR signer accepts only a SwapKit deposit that names exactly that transfer (same receiver and amount, no memo or pre-built transaction). An unaffordable NEAR-source swap fails with the `not-enough-funds` shortfall before signing.
