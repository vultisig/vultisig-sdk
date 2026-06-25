---
'@vultisig/cli': patch
---

Harden agent `sign_typed_data`: replace the hand-rolled EIP-712 encoder with viem's `hashTypedData` (matching the digest ethers `TypedDataEncoder.hash` produces), enforce low-S (EIP-2) canonicalization on the MPC signature, and add a recover-verify gate that confirms the assembled signature recovers to the vault's EVM address (throws an actionable, non-retryable `SIGNATURE_RECOVERY_MISMATCH` vault-context error otherwise — naming both addresses and pointing the caller at the loaded vault/keyshare rather than failing blank). Fixes wrong-domain-separator digests for domains that omit `verifyingContract` (Polymarket ClobAuth) or carry `salt`, and prevents malleable/unrecoverable signatures from being returned as success.
