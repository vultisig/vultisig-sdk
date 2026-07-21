---
'@vultisig/core-mpc': patch
---

fix(qbtc): thread proto field-7 `gasLimit` into the QBTC AuthInfo encoder so a QBTC tx that supplies a simulated gas limit is no longer capped at the flat `300000` default. This is a no-op while field 7 is unset, which is the case for every QBTC tx today (the QBTC chain-specific resolver never populates it). Adds golden vectors pinning the QBTC fee/gas split: fee amount from field-3 `gas`, gas limit from field-7-or-300000. QBTC's fee is deliberately flat and, unlike the shared `resolveCosmosGasFee` path, does not scale with the limit.
