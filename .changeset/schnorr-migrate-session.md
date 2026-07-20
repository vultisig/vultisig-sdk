---
'@vultisig/mpc-wasm': patch
---

Implement `createMigrateSession` on the WASM Schnorr engine so GG20→DKLS vault upgrades can migrate the EdDSA keyshare. Previously the EdDSA migration step threw `schnorr engine does not support createMigrateSession` because the method was declared optional on `SchnorrEngine` and never wired up, even though the underlying `SchnorrKeygenSession.migrate` WASM binding exists. Mirrors the existing DKLS engine implementation.
