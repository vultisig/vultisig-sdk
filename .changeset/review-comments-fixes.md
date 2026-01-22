---
"@anthropic/vultisig-sdk": patch
---

fix: address review comments for type safety and test reliability

**Type safety:**
- JoinSecureVaultOptions: make `devices` field required (was optional but enforced at runtime)
- parseKeygenQR: validate chains against Chain enum instead of unsafe cast

**Test improvements:**
- generateTestPartyId: use deterministic index-based suffix to avoid collisions
- multi-party-keygen-helpers: fail-fast when chainCodeHex is missing instead of silent fallback
- languageDetection tests: replace invalid Chinese mnemonics with valid BIP39 test vectors
- Add Chinese Simplified and Traditional language detection tests

**Documentation:**
- README: rename "Import from Seedphrase" to "Create Vault from Seedphrase" to match API naming
