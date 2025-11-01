# Vultisig SDK Architecture Documentation

This directory contains comprehensive documentation for the Vultisig SDK architecture.

---

## Core Documentation

### [ARCHITECTURE.md](./ARCHITECTURE.md)
**Complete SDK architecture overview** - Start here for a high-level understanding.

**Contents:**
- Directory structure and organization
- Core classes (Vultisig, Vault, ChainConfig, ServerManager)
- Manager Pattern architecture (VaultManager, ChainManager, WASMManager)
- Service Injection pattern
- Chain support architecture (Strategy Pattern)
- Service layer with Blockchair integration
- Three-tier caching strategy
- Design patterns used throughout the SDK
- Vault types (Fast vs Secure)
- Public API surface
- Security considerations

**Read this to:** Understand how the SDK is architected and how different components work together.

---

## Component Documentation

### [MANAGERS.md](./MANAGERS.md)
**Manager Pattern deep dive** - Detailed documentation for SDK managers.

**Contents:**
- VaultManager - Vault lifecycle, import/export, service injection
- ChainManager - Chain configuration and validation
- WASMManager - WASM module loading and lazy initialization
- ServerManager - Server communication overview
- AddressBookManager - Global address book (stub)
- Manager pattern benefits and architecture

**Read this to:** Understand manager responsibilities, APIs, and the manager pattern.

### [SERVICES.md](./SERVICES.md)
**Service Layer deep dive** - Comprehensive service documentation.

**Contents:**
- Service Injection pattern
- AddressService - Address derivation
- BalanceService - Balance fetching with Blockchair
- SigningService - Transaction parsing and validation
- FastSigningService - Server-assisted signing
- CacheService - TTL-based caching
- Blockchair Smart Resolver system
- Service configuration and customization

**Read this to:** Understand the service layer architecture and Blockchair integration.

---

## Chain Documentation

### [CHAIN_CONFIG.md](./CHAIN_CONFIG.md)
**ChainConfig centralized configuration system** - Chain metadata and configuration.

**Contents:**
- Chain metadata structure and registry
- Chain type system (EVM, UTXO, Cosmos, Other)
- Chain alias system for flexible identification
- Core API reference (getMetadata, getChainEnum, getDecimals, etc.)
- Validation and querying methods
- Adding new chains to ChainConfig
- Integration examples
- Migration guide from old architecture

**Read this to:** Understand the ChainConfig system and how to add new chain metadata.

### [ADDING_CHAINS.md](./ADDING_CHAINS.md)
**Step-by-step guide for adding blockchain support** - Chain implementation guide.

**Contents:**
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

## Status Documentation

### [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md)
**Feature matrix and implementation status** - What's done, what's in progress, what's planned.

**Contents:**
- Feature matrix (core features, chains, managers, services)
- Fully implemented chains (EVM, UTXO, Solana)
- Metadata-only chains (Cosmos, Cardano, etc.)
- MPC operations status
- Vault types status (Fast vs Secure)
- Testing status
- Roadmap and priorities

**Read this to:** Understand what features are available and what's coming next.

---

## Quick Links to Source Code

### Core SDK Components
- **Main SDK:** [VultisigSDK.ts](../../packages/sdk/src/VultisigSDK.ts)
- **Vault:** [Vault.ts](../../packages/sdk/src/vault/Vault.ts)
- **Public API:** [index.ts](../../packages/sdk/src/index.ts)

### Managers
- **VaultManager:** [VaultManager.ts](../../packages/sdk/src/VaultManager.ts)
- **ChainManager:** [ChainManager.ts](../../packages/sdk/src/ChainManager.ts)
- **WASMManager:** [WASMManager.ts](../../packages/sdk/src/wasm/WASMManager.ts)
- **ServerManager:** [ServerManager.ts](../../packages/sdk/src/server/ServerManager.ts)

### Configuration
- **ChainConfig:** [ChainConfig.ts](../../packages/sdk/src/chains/config/ChainConfig.ts)
- **VaultServices:** [VaultServices.ts](../../packages/sdk/src/vault/VaultServices.ts)

### Chain Strategies
- **Strategy Interface:** [ChainStrategy.ts](../../packages/sdk/src/chains/strategies/ChainStrategy.ts)
- **Strategy Factory:** [ChainStrategyFactory.ts](../../packages/sdk/src/chains/strategies/ChainStrategyFactory.ts)
- **EVM Strategy:** [EvmStrategy.ts](../../packages/sdk/src/chains/evm/EvmStrategy.ts)
- **UTXO Strategy:** [UtxoStrategy.ts](../../packages/sdk/src/chains/utxo/UtxoStrategy.ts)
- **Solana Strategy:** [SolanaStrategy.ts](../../packages/sdk/src/chains/solana/SolanaStrategy.ts)

### Services
- **AddressService:** [AddressService.ts](../../packages/sdk/src/vault/services/AddressService.ts)
- **BalanceService:** [BalanceService.ts](../../packages/sdk/src/vault/services/BalanceService.ts)
- **SigningService:** [SigningService.ts](../../packages/sdk/src/vault/services/SigningService.ts)
- **FastSigningService:** [FastSigningService.ts](../../packages/sdk/src/vault/services/FastSigningService.ts)
- **CacheService:** [CacheService.ts](../../packages/sdk/src/vault/services/CacheService.ts)

### Blockchair Integration
- **Smart Resolver:** [integration.ts](../../packages/sdk/src/vault/balance/blockchair/integration.ts)
- **Config:** [config.ts](../../packages/sdk/src/vault/balance/blockchair/config.ts)
- **EVM Resolver:** [resolvers/evm.ts](../../packages/sdk/src/vault/balance/blockchair/resolvers/evm.ts)
- **Solana Resolver:** [resolvers/solana.ts](../../packages/sdk/src/vault/balance/blockchair/resolvers/solana.ts)

---

## Module-Specific Documentation

Additional documentation can be found in module directories:

- **EVM Module:** [packages/sdk/src/chains/evm/README.md](../../packages/sdk/src/chains/evm/README.md)
- **Blockchair Module:** [packages/sdk/src/vault/balance/blockchair/README.md](../../packages/sdk/src/vault/balance/blockchair/README.md)
- **Server Integration:**
  - [Fast Signing](../../packages/sdk/src/server/FAST-SIGNING.md)
  - [Keygen Flow](../../packages/sdk/src/server/KEYGEN-FLOW-RELAY.md)
  - [Session Usage](../../packages/sdk/src/server/SESSION-USAGE.md)
  - [API Usage](../../packages/sdk/src/server/VULTISERVER-API-USAGE.md)

---

## Documentation Index

| Document | Purpose | Audience |
|----------|---------|----------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | High-level SDK architecture | All developers |
| [MANAGERS.md](./MANAGERS.md) | Manager pattern details | SDK contributors |
| [SERVICES.md](./SERVICES.md) | Service layer details | SDK contributors |
| [CHAIN_CONFIG.md](./CHAIN_CONFIG.md) | Chain configuration system | Chain integrators |
| [ADDING_CHAINS.md](./ADDING_CHAINS.md) | Add new blockchain support | Chain developers |
| [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) | Feature status and roadmap | All stakeholders |

---

**Last Updated:** 2025-11-01
