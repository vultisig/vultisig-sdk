# Vultisig SDK Architecture Documentation

This directory contains documentation for the Vultisig SDK architecture.

## Documentation

### [ARCHITECTURE.md](./ARCHITECTURE.md)
Complete overview of the Vultisig SDK architecture, including:
- Directory structure and organization
- Core classes (Vultisig, Vault, ChainManager, ServerManager)
- Chain support architecture (Strategy Pattern)
- Service layer architecture
- Design patterns used throughout the SDK
- Vault types (Fast vs Secure)
- Key features (Blockchair integration, caching, multi-message signing)
- Public API surface
- Security considerations

**Read this to:** Understand how the SDK is architected and how different components work together.

### [ADDING_CHAINS.md](./ADDING_CHAINS.md)
Step-by-step guide for adding new blockchain support to the SDK, including:
- Prerequisites and requirements
- Complete implementation guide
- ChainStrategy interface implementation
- Address derivation, balance fetching, transaction parsing
- Pre-signing hash computation and signature formatting
- Common patterns (EVM-compatible, single-message, multi-message)
- Testing checklist
- Troubleshooting guide
- Example implementations

**Read this to:** Add support for a new blockchain to the Vultisig SDK.

---

## Quick Links

- **Main SDK:** [VultisigSDK.ts](../../packages/sdk/src/VultisigSDK.ts)
- **Vault:** [Vault.ts](../../packages/sdk/src/vault/Vault.ts)
- **Chain Strategies:** [chains/strategies/](../../packages/sdk/src/chains/strategies/)
- **Services:** [vault/services/](../../packages/sdk/src/vault/services/)
- **Public API:** [index.ts](../../packages/sdk/src/index.ts)

---

**Last Updated:** 2025-10-29
