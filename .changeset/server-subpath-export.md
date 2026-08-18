---
'@vultisig/sdk': minor
---

Add the public `@vultisig/sdk/server` subpath export. This promotes `src/server/index.ts` from an orphan module (unreachable from any entry) to permanently-supported public API — the full surface is 17 symbols, not just the 8 documented fast-vault helpers (checkVaultExistsOnServer, createVaultWithServer, getVaultFromServer, keyImportWithServer, migrateWithServer, resendVaultShare, sequentialKeyImportWithServer, setupVaultWithServer, verifyVaultEmailCode):

- Raw server-signing/reshare/key-import primitives (`signWithServer`, `mldsaWithServer`, `reshareWithServer`, `batchReshareWithServer`) — these bypass the `vault.sign('fast', payload)` path the module's own docblock recommends. Exposed deliberately for advanced consumers building custom flows (e.g. co-signing arbitrary pre-hashed messages on a caller-chosen derivation path); most consumers should still prefer `vault.sign('fast', payload)`.
- Relay session primitives (`joinMpcSession`, `sendMpcRelayMessage`, `getMpcRelayMessages`, `deleteMpcRelayMessage`, `uploadMpcSetupMessage`, `waitForSetupMessage`) and the wire-format converters (`toMpcServerMessage`, `fromMpcServerMessage`).
