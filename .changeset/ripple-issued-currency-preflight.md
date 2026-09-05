---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

Refuse XRPL issued-currency Payments the ledger would reject — a destination holding no trust line for the token, and an issuer that charges a transfer fee the payload cannot yet cover with a SendMax — instead of burning the fee on-chain. Accept the lowercase standard currency codes XRPL permits, report bad amounts and unusable destinations as domain errors, and pin both encoders against a shared issued-currency signing vector.
