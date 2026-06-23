---
'@vultisig/cli': patch
---

Harden agent `sign_typed_data`: replace the hand-rolled EIP-712 encoder with viem's `hashTypedData` (matching the digest ethers `TypedDataEncoder.hash` produces), enforce low-S (EIP-2) canonicalization on the MPC signature, and add a recover-verify gate that confirms the assembled signature recovers to the vault's EVM address (throws `SIGNATURE_RECOVERY_MISMATCH` otherwise). Fixes wrong-domain-separator digests for domains that omit `verifyingContract` (Polymarket ClobAuth) or carry `salt`, and prevents malleable/unrecoverable signatures from being returned as success.
