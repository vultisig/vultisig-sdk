# VultisigSDK Transformation Plan

## Overview
Transform the current Vultisig repository into a TypeScript SDK for web applications, removing desktop client and Go backend while preserving core cryptographic and blockchain functionality.

## Phase 1: Cleanup & Removal

### 1.1 Remove Desktop Client
- [ ] Delete `clients/desktop/` directory
- [ ] Remove desktop-specific dependencies from root `package.json`
- [ ] Remove desktop build scripts (`dev:desktop`, `build:desktop`)
- [ ] Clean up `wails.json` references

### 1.2 Remove Go Backend
- [ ] Delete Go files: `main.go`, `app.go`, `install_marker.go`
- [ ] Remove directories: `tss/`, `storage/`, `relay/`, `mediator/`, `utils/`
- [ ] Delete `go.mod`, `go.sum`
- [ ] Remove build configurations: `build/`, `ci/`

### 1.3 Clean Root Structure
- [ ] Remove `wails.json`
- [ ] Update root `package.json` workspaces to exclude deleted paths
- [ ] Clean up build scripts and dependencies

**Phase 1 Completion Check:**
- **Must See**: No desktop client directory, no Go files in root
- **Must Test**: `yarn install` runs without desktop/Go dependencies
- **Must Show**: Clean root directory with only core/, lib/, clients/extension/, examples/

## Phase 2: SDK Structure Setup

### 2.1 Create SDK Entry Point
- [ ] Create `src/index.ts` as main SDK export
- [ ] Create `package.json` for publishable SDK package
- [ ] Set up TypeScript configuration for library build

### 2.2 Restructure Core Exports
- [ ] Map `core/` modules to SDK public API
- [ ] Create barrel exports for major SDK features:
  - MPC operations (`src/mpc/`)
  - Chain integrations (`src/chains/`)
  - Vault management (`src/vault/`)
  - Server communication (`src/server/`)
  - Cryptographic utilities (`src/crypto/`)
- [ ] Import existing vault handling code from:
  - `core/ui/vault/` - All vault operations and utilities
  - `core/ui/passcodeEncryption/` - Encryption/decryption logic
  - `core/extension/storage/vaults.ts` - Storage interface patterns
  - `lib/utils/encryption/` - AES-GCM cryptographic utilities

### 2.3 WASM Bundle Integration
- [ ] Ensure `lib/dkls/`, `lib/schnorr/` WASM bundles are web-compatible
- [ ] Configure wallet-core WASM loading for web environments
- [ ] Create WASM initialization utilities in SDK

**Phase 2 Completion Check:**
- **Must See**: `src/index.ts` exists with clear barrel exports
- **Must Test**: `npm run build` produces library outputs (ESM/CJS)
- **Must Show**: TypeScript declarations and proper package.json for SDK

## Phase 3: Server Communication & Web Build

### 3.1 VultiServer Integration
- [ ] Preserve Fast Vault server API endpoints:
  - `POST /vault/create` - Server-assisted vault creation
  - `GET /vault/get/{vaultId}` - Encrypted vault retrieval
  - `POST /vault/migrate` - Vault migration to server
  - `POST /vault/reshare` - Vault participant management
  - `POST /vault/sign` - Server-assisted signing operations
  - `GET /vault/verify/{vaultId}/{code}` - Email verification
- [ ] Maintain AES-256-GCM encryption for server communication
- [ ] Implement password-based vault access (base64 headers)

### 3.2 Message Relay Server Integration
- [ ] Preserve relay server endpoints:
  - `POST /message/{sessionId}` - MPC message upload
  - `GET /message/{sessionId}/{localPartyId}` - Message retrieval
  - `DELETE /message/{sessionId}/{localPartyId}/{hash}` - Message cleanup
  - `POST /setup-message/{sessionId}` - Setup message handling
- [ ] Maintain encrypted message relay protocol
- [ ] Implement session management and party coordination
- [ ] Handle message deduplication and sequencing

### 3.3 Web Build Configuration
- [ ] Configure Vite/Rollup for library build targeting web
- [ ] Set up multiple output formats (ESM, CJS, UMD)
- [ ] Configure WASM asset handling for web bundlers
- [ ] Add source maps and TypeScript declaration files
- [ ] Ensure HTTPS-only server communication for browser security

### 3.4 Dependencies Management
- [ ] Review and optimize dependencies for web usage
- [ ] Ensure all crypto operations work in browser environments
- [ ] Remove Node.js-specific dependencies where possible
- [ ] Preserve axios/fetch for server communication

**Phase 3 Completion Check:**
- **Must See**: Successful API calls to VultiServer endpoints
- **Must Test**: WASM modules load in browser environment
- **Must Show**: Encrypted message relay between test devices/sessions

## Phase 4: SDK Public API Design

### 4.1 Core SDK Class

```typescript
class VultisigSDK {
  // VultiServer-based operations
  createVault(options: VaultOptions): Promise<Vault>
  verifyVault(vaultId: string, code: string): Promise<boolean>
  resendVaultVerification(vaultId: string): Promise<void>
  getVaultFromServer(vaultId: string, password: string): Promise<Vault>
  signWithServer(vault: Vault, payload: SigningPayload): Promise<Signature>
  reshareVault(vault: Vault, reshareOptions: ReshareOptions): Promise<Vault>
  
  // Server status and health
  checkServerStatus(): Promise<ServerStatus>
  
  // Vault handling operations (wrapping existing core/lib code)
  isVaultEncrypted(vault: Vault): boolean
  encryptVault(vault: Vault, passcode: string): Promise<Vault>
  decryptVault(vault: Vault, passcode: string): Promise<Vault>
  exportVault(vault: Vault, options?: ExportOptions): Promise<VaultBackup>
  importVault(backup: VaultBackup, password?: string): Promise<Vault>
  getVaultDetails(vault: Vault): VaultDetails
  validateVault(vault: Vault): VaultValidationResult
  
  // Local SDK operations
  getAddresses(vault: Vault, chains: ChainKind[]): Record<ChainKind, string>
  getBalances(addresses: Record<ChainKind, string>): Promise<Record<ChainKind, Balance>>
  
  // Chain operations
  getChainClient(chain: ChainKind): ChainClient
  
  // Relay server for multi-device MPC
  private messageRelay: MessageRelayClient
  private encryptionManager: MessageEncryptionManager
}
```

### 4.2 Key Exports Structure
- [ ] `VultisigSDK` - Main SDK class with server integration
- [ ] `Vault` - Core vault type and utilities (from `core/ui/vault/Vault.ts`)
- [ ] `VaultFolder` - Vault organization (from `core/ui/vault/VaultFolder.ts`)
- [ ] `VaultEncryption` - AES-GCM encryption utilities (from `lib/utils/encryption/`)
- [ ] `VaultBackup` - Import/export functionality (from `core/ui/vault/backup/`)
- [ ] `Chain` clients for supported blockchains  
- [ ] `MPC` operations (keygen, keysign, reshare) with relay server
- [ ] `MessageRelay` - Server communication for multi-device MPC
- [ ] `FastVault` - Server-assisted vault operations
- [ ] `Utils` - Cryptographic and utility functions

### 4.4 Vault Management API (Existing Code Integration)
*Note: All vault handling functionality already exists in core/lib - SDK will import/wrap these for clean public API*

```typescript
// Vault encryption/decryption (from core/ui/passcodeEncryption/core/)
interface VaultEncryption {
  encryptVaultKeyShares(vault: Vault, passcode: string): Promise<Vault>
  decryptVaultKeyShares(vault: Vault, passcode: string): Promise<Vault>
  isVaultEncrypted(vault: Vault): boolean
}

// Vault export/import (from core/ui/vault/mutations/)
interface VaultBackupManager {
  exportVault(vault: Vault, password?: string): Promise<VaultBackup>
  importVault(backup: ArrayBuffer | VaultContainer, password?: string): Promise<Vault>
  detectBackupType(backup: ArrayBuffer): 'DKLS' | 'GG20' | 'Unknown'
}

// Vault details and validation (from core/ui/vault/)
interface VaultManager {
  getVaultDetails(vault: Vault): VaultDetails
  validateVault(vault: Vault): VaultValidationResult
  getVaultSecurityType(vault: Vault): 'fast' | 'secure'
  getVaultChains(vault: Vault): ChainKind[]
  getVaultAddresses(vault: Vault): Record<ChainKind, string>
}
```

### 4.3 Server Configuration
- [ ] Support configurable server endpoints:
  - Fast Vault Server: `https://api.vultisig.com/vault`
  - Message Relay Server: `https://api.vultisig.com/router`
  - Server Status Check: `https://api.vultisig.com/router/ping`
- [ ] Environment-specific server selection
- [ ] Custom server endpoint configuration for enterprise use
- [ ] Server health monitoring and status checks

**Phase 4 Completion Check:**
- **Must See**: Clean SDK public API with TypeScript intellisense
- **Must Test**: All vault operations (encrypt, decrypt, export, import)
- **Must Show**: VaultisigSDK class instantiation with working methods

## Phase 5: Examples & Extension

### 5.1 React Example
- [ ] Create `examples/react/` directory
- [ ] Build sample React app demonstrating SDK usage
- [ ] Include examples for:
  - Vault creation and management
  - Multi-chain transaction signing

### 5.2 Extension Compatibility
- [ ] Keep `clients/extension/` as reference implementation
- [ ] Ensure extension continues working as proof-of-concept

**Phase 5 Completion Check:**
- **Must See**: Working React app demonstrating SDK features
- **Must Show**: Multi-device vault creation and signing examples

## Phase 6: Documentation & Testing

### 6.1 API Documentation
- [ ] Generate TypeScript API documentation
- [ ] Create usage guides and tutorials
- [ ] Document WASM initialization requirements

### 6.2 Testing
- [ ] Set up unit tests for SDK public API
- [ ] Test WASM operations in browser environments
- [ ] Integration tests with example applications

**Phase 6 Completion Check:**
- **Must See**: Comprehensive API documentation and usage guides
- **Must Test**: Unit tests passing for all SDK methods
- **Must Show**: Working examples and integration test results

## Phase 7: Package Publishing

### 7.1 NPM Package Setup
- [ ] Configure package.json for npm publishing
- [ ] Set up CI/CD for automated builds and releases
- [ ] Create README with installation and usage instructions

### 7.2 Bundle Analysis
- [ ] Analyze bundle size and optimize
- [ ] Ensure tree-shaking works correctly
- [ ] Document bundle size and runtime requirements

**Phase 7 Completion Check:**
- **Must See**: Published npm package with proper versioning
- **Must Test**: `npm install vultisig-sdk` works in fresh project
- **Must Show**: Bundle analysis report and performance metrics

## Key Considerations

### WASM Handling
- Ensure WASM modules (dkls, schnorr, wallet-core) load properly in web environments
- Handle async WASM initialization in SDK
- Provide fallbacks or error handling for WASM loading failures

### Server Communication Security
- **End-to-End Encryption**: All server messages use AES-256-GCM encryption
- **No Server-Side Keys**: Server never has access to unencrypted key material
- **Ephemeral Storage**: Messages automatically deleted after processing
- **Password Protection**: Vault access secured with password-based authentication
- **HTTPS Only**: All server communication over TLS in production

### MPC Protocol Preservation
- **Message Relay Compatibility**: Exact protocol compatibility for multi-device coordination
- **Session Management**: Proper session lifecycle and participant tracking  
- **Message Ordering**: Sequence numbers and deduplication for reliable delivery
- **Timeout Handling**: Robust error handling and retry mechanisms
- **Encryption Key Management**: Secure generation and distribution of session keys

### Security
- Maintain all existing cryptographic security guarantees
- Ensure MPC operations remain secure in browser context
- Document security considerations for SDK users
- Preserve server-side security model (encrypted storage, no plaintext keys)

### Backward Compatibility
- Keep extension working as reference implementation
- Maintain core business logic and MPC protocols
- Preserve vault format compatibility
- Ensure server API compatibility for seamless migration

## Success Criteria
- [ ] Publishable TypeScript SDK package
- [ ] Working React example application
- [ ] Extension using SDK instead of direct core imports
- [ ] All WASM bundles loading correctly in web environment
- [ ] Core MPC and blockchain functionality preserved
- [ ] Clean, documented public API