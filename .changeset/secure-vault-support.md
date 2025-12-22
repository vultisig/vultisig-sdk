---
"@vultisig/sdk": minor
"@vultisig/cli": minor
---

feat: Add SecureVault support for multi-device MPC vaults

- Implement SecureVault.create() for multi-device keygen ceremony
- Add RelaySigningService for coordinated signing via relay server
- Implement SecureVault.sign() and signBytes() methods
- Add QR code generation for mobile app pairing (compatible with Vultisig iOS/Android)
- CLI: Add `vault create --type secure` with terminal QR display
- CLI: Support secure vault signing with device coordination
- Add comprehensive unit, integration, and E2E tests
