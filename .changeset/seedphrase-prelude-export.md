---
'@vultisig/sdk': patch
---

Export the canonical `prepareSeedphraseImportPrelude` helper from `@vultisig/sdk/seedphrase` so first-party consumers can reuse the SDK-owned seedphrase validation, chain-discovery, Phantom/Terra path selection, and `chainsToImport` resolution flow instead of reimplementing it locally.
