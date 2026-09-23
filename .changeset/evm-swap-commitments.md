---
'@vultisig/sdk': patch
---

Reject independently decoded EVM swap source-amount/asset mismatches and expired router deadlines during both vault-free and vault-wrapped preparation. Cover verified 1inch and Kyber layouts plus named Ethereum THORChain and Universal Router deployments. Native THOR deposits use transaction value, and known deadlines remain enforced when inner amounts or balance sentinels cannot be interpreted. Unknown layouts retain the existing quote binding and expiry safeguards; see `docs/evm-swap-commitments.md` for the coverage and residuals.
