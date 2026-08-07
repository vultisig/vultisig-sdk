---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

Fail closed when LI.FI returns a destination outside its official chain-scoped Diamond deployments. Require independent benign Blockaid reputation verdicts for SwapKit EVM transaction destinations and approval spenders at quote construction and on the co-signer path, while retaining response-local target-address binding as defense in depth.
