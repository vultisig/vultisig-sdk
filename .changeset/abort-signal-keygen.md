---
"@vultisig/sdk": minor
---

Add AbortSignal support for keygen and seedphrase import operations

- Added `signal?: AbortSignal` parameter to `createFastVault()`, `createSecureVault()`, `importSeedphraseAsFastVault()`, and `importSeedphraseAsSecureVault()`
- Abort checks are performed at natural breakpoints: in waitForPeers loops, between ECDSA/EdDSA keygen phases, and between per-chain key imports
- Allows users to cancel long-running vault creation operations gracefully using standard AbortController API
