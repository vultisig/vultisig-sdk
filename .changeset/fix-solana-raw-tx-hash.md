---
'@vultisig/core-mpc': patch
---

Populate Solana `SigningOutput.signatures` when compiling dApp-supplied raw transactions so downstream transaction-hash resolution returns the spliced fee-payer signature instead of crashing after keysign.
