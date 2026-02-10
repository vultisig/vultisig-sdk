---
"@vultisig/sdk": patch
---

Fix opaque "is not a function" error when chain value doesn't match enum (e.g. BCH). match() now throws a descriptive error with the bad value and available handlers. Also fix incorrect CoinType mappings for CronosChain and Sei in MasterKeyDeriver.
