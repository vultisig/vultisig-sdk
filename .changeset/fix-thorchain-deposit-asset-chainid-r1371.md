---
'@vultisig/core-mpc': patch
---

Throw a domain error naming both unresolved chains when `getThorchainDepositAsset` can't resolve a native-swap chain id, instead of failing with a bare `Cannot read properties of undefined (reading 'toUpperCase')` TypeError on the secured-asset path (and silently building an invalid `chain: undefined` proto on the unsecured path). Also adds test coverage for the previously-untested CIP-8/CIP-30 `buildCoseStructures` CBOR encoders.
