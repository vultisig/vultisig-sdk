---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Keep browser vault storage on the backend selected during initialization. IndexedDB failures and quota errors now surface without silently switching to a partial localStorage or in-memory view, while legacy localStorage vaults retain their backend across reloads.
