---
'@vultisig/core-mpc': patch
---

Splice a dApp raw Solana transaction's signature into the vault's own signer slot instead of always slot 0, so sponsored and multi-signer transactions where the vault is not the fee payer assemble correctly.
