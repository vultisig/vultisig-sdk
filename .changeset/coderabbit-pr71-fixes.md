---
"@vultisig/sdk": patch
"@vultisig/cli": patch
---

fix: address CodeRabbit PR #71 review suggestions

**Critical fixes:**
- JoinSecureVaultService: require `devices` parameter instead of defaulting to 2
- CLI vault-management: validate `devices` parameter before calling SDK
- parseKeygenQR: throw error on unknown libType instead of silently defaulting

**Code quality:**
- Replace try-catch with attempt() pattern in JoinSecureVaultService and parseKeygenQR
- Add abort signal checks in SecureVaultJoiner callbacks

**Documentation:**
- Add onProgress callback to joinSecureVault README documentation
- Fix markdown heading format in SDK-USERS-GUIDE.md
- Add language specifier to code block in CLAUDE.md

**Tests:**
- Fix Korean test mnemonic (removed invalid comma)
- Add Korean language detection test
- Remove sensitive private key logging in test helpers
