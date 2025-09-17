# VultisigSDK Implementation TODO

## Completed

### Core Infrastructure
- Auto-initialization and WASM integration
- Workspace bundling for core/ and lib/ packages
- Monorepo build system with proper TypeScript configuration
- Comprehensive test suite (29 tests passing)

### Address Operations
```typescript
VultisigSDK.deriveAddress(vault: Vault, chain: string): Promise<string>
Vault.address(chain: string): Promise<string>
Vault.addresses(chains?: string[]): Promise<Record<string, string>>
```

### Static Validation Methods
```typescript
VultisigSDK.validateEmail(email: string): ValidationResult
VultisigSDK.validatePassword(password: string): ValidationResult
VultisigSDK.validateVaultName(name: string): ValidationResult
```

### Vault Operations (Partial)
```typescript
// Completed in Vault class:
async rename(newName: string): Promise<void>
async export(password?: string): Promise<Blob>
```

## Partially Completed

### Vault Lifecycle Management
**ARCHITECTURAL ISSUE**: VaultManager class exists but should be removed per VAULTPLAN
```typescript
// Currently in VaultManager (WRONG - should be in Vultisig class):
VaultManager.create(name: string, options?: VaultOptions): Promise<Vault>
VaultManager.add(file: File, password?: string): Promise<Vault>
VaultManager.list(): Promise<Summary[]>
VaultManager.remove(vault: Vault): Promise<void>
VaultManager.clear(): Promise<void>

// Currently in VultisigSDK (correct but incomplete wrappers):
VultisigSDK.createVault(name: string, options?: VaultOptions): Promise<Vault>
VultisigSDK.addVault(file: File, password?: string): Promise<Vault>
VultisigSDK.listVaults(): Promise<Vault[]>
VultisigSDK.deleteVault(vault: Vault): Promise<void>
```

### Address Book Management
**ARCHITECTURAL ISSUE**: Currently in VaultManager but should be in Vultisig class
```typescript
// Currently in VaultManager (WRONG - should be in Vultisig class):
VaultManager.addressBook(chain?: string): Promise<AddressBook>
VaultManager.addAddressBookEntry(entries: AddressBookEntry[]): Promise<void>
VaultManager.removeAddressBookEntry(addresses: Array<{chain: string, address: string}>): Promise<void>
VaultManager.updateAddressBookEntry(chain: string, address: string, name: string): Promise<void>
```

### Chain Management Hierarchy
**ARCHITECTURAL ISSUE**: Mixed between VaultManager and correct classes
```typescript
// Correct (in VultisigSDK):
VultisigSDK.getSupportedChains(): string[]
VultisigSDK.setDefaultChains(chains: string[]): void

// WRONG (in VaultManager - should be in Vultisig):
VaultManager.setDefaultChains(chains: string[]): void
VaultManager.setDefaultCurrency(currency: string): void

// Correct (in Vault class):
Vault.setChains(chains: string[]): Promise<void>
Vault.getChains(): string[]
Vault.addChain(chain: string): Promise<void>
Vault.removeChain(chain: string): Promise<void>
```

### Currency Management
**ARCHITECTURAL ISSUE**: Mixed between VaultManager and correct classes
```typescript
// Correct (in VultisigSDK):
VultisigSDK.setDefaultCurrency(currency: string): void

// WRONG (in VaultManager - should be in Vultisig):
VaultManager.setDefaultCurrency(currency: string): void

// Correct (in Vault class):
Vault.setCurrency(currency: string): void
Vault.getCurrency(): string
```

### Balance Infrastructure
ChainManager has balance fetching, missing Vault class methods:
```typescript
// Missing from Vault class:
async balance(chain: string, tokenId?: string): Promise<Balance>
async balances(chains?: string[], includeTokens?: boolean): Promise<Record<string, Balance>>
async updateBalance(chain: string, tokenId?: string): Promise<Balance>
async updateBalances(chains?: string[], includeTokens?: boolean): Promise<Record<string, Record<string, Balance>>>
```

### Gas Estimation
Method exists but throws error:
```typescript
// Missing implementation:
async gas(chain: string): Promise<GasInfo>
async estimateGas(params: any): Promise<GasEstimate>
```

### Email Verification for Vaults
SDK level implemented, missing from Vault class:
```typescript
// Missing from Vault class:
async verifyEmail(code: string): Promise<boolean>
async resendVerificationEmail(): Promise<void>
```

### Caching Strategy
Only address caching implemented, missing:
- Balance caching with TTL
- Price data caching
- Gas price caching

### Progress Callbacks
Types defined, partial implementation in ServerManager

### VultisigSDK Configuration Management
```typescript
// Missing:
updateConfig(config: Partial<VultisigConfig>): void
getStatus(): Promise<VultisigStatus>
```

### Enhanced Error Handling
VaultError classes implemented, missing graceful degradation

## To Be Done

### **CRITICAL: Remove VaultManager Class**
**Architecture violation**: VaultManager should not exist per VAULTPLAN.md
- Move all VaultManager methods into Vultisig class
- Remove VaultManager class entirely
- Update all imports and references
- Ensure two-class architecture: Vultisig + Vault only

### Vault Balance Management
```typescript
// Missing from Vault class:
async balance(chain: string, tokenId?: string): Promise<Balance>
async balances(chains?: string[], includeTokens?: boolean): Promise<Record<string, Balance>>
async updateBalance(chain: string, tokenId?: string): Promise<Balance>
async updateBalances(chains?: string[], includeTokens?: boolean): Promise<Record<string, Record<string, Balance>>>
```

### Transaction Signing
```typescript
// Missing from Vault class:
async sign(payload: SigningPayload): Promise<Signature>
```
Needs: MPC signing implementation, progress callbacks, broadcasting, mode selection

### Token Management
```typescript
// Missing from Vault class:
setTokens(chain: string, tokens: Token[]): void
addToken(chain: string, token: Token): void
removeToken(chain: string, tokenId: string): void
getTokens(chain: string): Token[]
```

### Fiat Value Operations
```typescript
// Missing from Vault class:
async getValue(chain: string, tokenId?: string): Promise<Value>
async getValues(chain: string): Promise<Record<string, Value>>
async updateValues(chain: string | 'all'): Promise<void>
async getTotalValue(): Promise<Value>
async updateTotalValue(): Promise<Value>
```

### Vault Operations (Complete)
```typescript
// Missing from Vault class:
async reshare(options: ReshareOptions): Promise<Vault>
```