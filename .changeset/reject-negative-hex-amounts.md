---
'@vultisig/lib-utils': patch
'@vultisig/core-mpc': patch
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Reject negative amounts before hexadecimal encoding so EVM and Cardano transaction inputs cannot silently contain empty amount bytes. Preserve existing encodings for non-negative values, including unsigned Long quantities.
