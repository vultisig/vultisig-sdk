---
"@vultisig/sdk": minor
---

Add ML-DSA-44 post-quantum signing to FastVault (server-assisted keygen and signing, optional `addMldsa` for existing vaults). Fast MPC APIs accept optional `vaultBaseUrl`; email verification uses the configured vault URL. CLI supports `VULTISIG_API_URL` and `VULTISIG_ROUTER_URL` for local testing. Fixes derivation path when signing with per-chain keyshares from key-import vaults.
