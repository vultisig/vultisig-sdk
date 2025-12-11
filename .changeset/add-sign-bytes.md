---
"@vultisig/sdk": minor
---

feat(sdk): add signBytes() method for signing arbitrary pre-hashed data

Adds a new `signBytes()` method to vaults that allows signing arbitrary byte arrays:

- Accepts `Uint8Array`, `Buffer`, or hex string input
- Uses chain parameter to determine signature algorithm (ECDSA/EdDSA) and derivation path
- Available on FastVault (implemented) and SecureVault (placeholder for future)

Example usage:
```typescript
const sig = await vault.signBytes({
  data: keccak256(message),
  chain: Chain.Ethereum
})
```
