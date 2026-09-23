---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Reject all-zero Bittensor and Polkadot transfer destinations before producing signing inputs or unsigned transfer bytes, including alternate zero-account encodings accepted by the direct Bittensor builder.
