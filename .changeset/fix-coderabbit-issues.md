---
"@vultisig/sdk": patch
---

Fix CodeRabbit review issues for beta-3 release

- Fix `@noble/hashes` import path for v2 compatibility (sha512 → sha2)
- Fix chainPublicKeys/chainKeyShares persistence in VaultData to prevent data loss on vault reload
