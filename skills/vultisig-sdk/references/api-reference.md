# API Reference

## Vultisig Class

Main SDK entry point for vault management.

### Constructor

```typescript
new Vultisig(config?: VultisigConfig)
```

**VultisigConfig:**
```typescript
interface VultisigConfig {
  storage?: Storage                    // Default: FileStorage (Node) / BrowserStorage
  defaultChains?: Chain[]              // Chains enabled for new vaults
  defaultCurrency?: string             // Fiat currency (default: 'USD')
  onPasswordRequired?: (vaultId: string, vaultName: string) => Promise<string>
  passwordCache?: { defaultTTL: number }  // Password cache TTL in ms
  cacheConfig?: {
    balanceTTL?: number               // Balance cache TTL (default: 300000)
    priceTTL?: number                 // Price cache TTL (default: 300000)
  }
}
```

### Lifecycle Methods

```typescript
// Initialize SDK (load WASM modules)
await sdk.initialize(): Promise<void>

// Clean up resources
sdk.dispose(): void
```

### Vault Creation

```typescript
// Create FastVault (returns vaultId, call verifyVault to complete)
await sdk.createFastVault(options: {
  name: string
  email: string
  password: string
  onProgress?: (step: VaultCreationStep) => void
}): Promise<string>

// Verify FastVault with email code (returns vault)
await sdk.verifyVault(vaultId: string, code: string): Promise<FastVault>

// Create SecureVault (multi-device)
await sdk.createSecureVault(options: {
  name: string
  devices: number
  threshold?: number
  password?: string
  onQRCodeReady?: (qrPayload: string) => void
  onDeviceJoined?: (deviceId: string, total: number, required: number) => void
  onProgress?: (step: VaultCreationStep) => void
}): Promise<{ vault: SecureVault, vaultId: string, sessionId: string }>
```

### Vault Management

```typescript
// List all vaults
await sdk.listVaults(): Promise<VaultBase[]>

// Get active vault
await sdk.getActiveVault(): Promise<VaultBase | null>

// Set active vault
await sdk.setActiveVault(vault: VaultBase | null): Promise<void>

// Get vault by ID
await sdk.getVaultById(id: string): Promise<VaultBase | null>

// Delete vault
await sdk.deleteVault(vault: VaultBase): Promise<void>

// Check if active vault exists
await sdk.hasActiveVault(): Promise<boolean>
```

### Import/Export

```typescript
// Import vault from .vult file content
await sdk.importVault(vultContent: string, password?: string): Promise<VaultBase>

// Check if vault file is encrypted
sdk.isVaultEncrypted(vultContent: string): boolean
```

### Seedphrase Operations

```typescript
// Validate seedphrase
await sdk.validateSeedphrase(mnemonic: string): Promise<SeedphraseValidation>

// Discover chains with balances
await sdk.discoverChainsFromSeedphrase(
  mnemonic: string,
  chains?: Chain[],
  onProgress?: (progress: ChainDiscoveryProgress) => void
): Promise<ChainDiscoveryAggregate>

// Create FastVault from seedphrase
await sdk.createFastVaultFromSeedphrase(options: {
  mnemonic: string
  name: string
  email: string
  password: string
  discoverChains?: boolean
  chains?: Chain[]
}): Promise<string>
```

---

## VaultBase Class

Shared methods for both FastVault and SecureVault.

### Properties

```typescript
vault.id: string              // Unique vault ID (ECDSA public key)
vault.name: string            // Display name
vault.type: 'fast' | 'secure' // Vault type
vault.isEncrypted: boolean    // Whether password required
vault.threshold: number       // Signing threshold
vault.chains: Chain[]         // Enabled chains
```

### Address Methods

```typescript
// Get address for single chain
await vault.address(chain: Chain): Promise<string>

// Get addresses for multiple chains
await vault.addresses(chains?: Chain[]): Promise<Record<string, string>>

// Validate address format
vault.isValidAddress(address: string, chain: Chain): boolean
```

### Balance Methods

```typescript
// Get balance for chain (with optional token)
await vault.balance(chain: Chain, tokenId?: string): Promise<Balance>

// Get balances for multiple chains
await vault.balances(chains?: Chain[], includeTokens?: boolean): Promise<Record<string, Balance>>

// Force refresh balance
await vault.updateBalance(chain: Chain, tokenId?: string): Promise<Balance>

// Force refresh all balances
await vault.updateBalances(chains?: Chain[], includeTokens?: boolean): Promise<Record<string, Balance>>
```

**Balance type:**
```typescript
interface Balance {
  amount: string        // Human-readable amount
  rawAmount: string     // Raw amount in smallest unit
  symbol: string        // Token symbol
  decimals: number
  fiatValue?: string    // Value in fiat currency
  currency?: string     // Fiat currency code
}
```

### Transaction Methods

```typescript
// Prepare send transaction
await vault.prepareSendTx(params: {
  coin: AccountCoin
  receiver: string
  amount: string        // In smallest unit (wei, satoshi, etc.)
  memo?: string
  feeSettings?: FeeSettings
}): Promise<KeysignPayload>

// Sign transaction payload
await vault.sign(
  payload: KeysignPayload,
  options?: SigningOptions
): Promise<Signature>

// Broadcast signed transaction
await vault.broadcastTx(params: {
  chain: Chain
  keysignPayload: KeysignPayload
  signature: Signature
}): Promise<string>  // Returns txHash

// Sign arbitrary bytes
await vault.signBytes(options: {
  data: Uint8Array | Buffer | string  // Hex string or bytes
  chain: Chain
}, signingOptions?: SigningOptions): Promise<Signature>

// Broadcast raw transaction
await vault.broadcastRawTx(params: {
  chain: Chain
  rawTx: string  // Hex-encoded signed tx
}): Promise<string>  // Returns txHash

// Get gas information
await vault.gas(chain: Chain): Promise<GasInfo>
```

**Signature type:**
```typescript
interface Signature {
  signature: string   // Hex-encoded (r || s for ECDSA)
  recovery?: number   // Recovery byte (ECDSA only)
}
```

### Swap Methods

```typescript
// Get swap quote
await vault.getSwapQuote(params: {
  fromCoin: AccountCoin | { chain: Chain, token?: string }
  toCoin: AccountCoin | { chain: Chain, token?: string }
  amount: number | string
  fiatCurrency?: string
}): Promise<SwapQuoteResult>

// Prepare swap transaction
await vault.prepareSwapTx(params: {
  fromCoin: AccountCoin | { chain: Chain }
  toCoin: AccountCoin | { chain: Chain }
  amount: number | string
  swapQuote: SwapQuoteResult
}): Promise<{ keysignPayload: KeysignPayload, approvalPayload?: KeysignPayload }>

// Get token allowance (ERC-20)
await vault.getTokenAllowance(coin: AccountCoin, spender: string): Promise<bigint>

// Check if swap supported
vault.isSwapSupported(fromChain: Chain, toChain: Chain): boolean

// Get supported swap chains
vault.getSupportedSwapChains(): readonly Chain[]
```

### Chain/Token Management

```typescript
// Chain management
await vault.setChains(chains: Chain[]): Promise<void>
await vault.addChain(chain: Chain): Promise<void>
await vault.removeChain(chain: Chain): Promise<void>
vault.getChains(): Chain[]
await vault.resetToDefaultChains(): Promise<void>

// Token management
vault.getTokens(chain: Chain): Token[]
await vault.setTokens(chain: Chain, tokens: Token[]): Promise<void>
await vault.addToken(chain: Chain, token: Token): Promise<void>
await vault.removeToken(chain: Chain, tokenId: string): Promise<void>
```

### Vault Management

```typescript
// Rename vault
await vault.rename(newName: string): Promise<void>

// Export vault backup
await vault.export(password?: string): Promise<{ filename: string, data: string }>

// Delete vault
await vault.delete(): Promise<void>

// Save changes
await vault.save(): Promise<void>
```

### Password/Lock Methods

```typescript
// Lock vault (clear cached password)
vault.lock(): void

// Unlock vault
await vault.unlock(password: string): Promise<void>

// Check if unlocked
vault.isUnlocked(): boolean

// Get remaining unlock time
vault.getUnlockTimeRemaining(): number | undefined
```

### Portfolio Methods

```typescript
// Get fiat value
await vault.getValue(chain: Chain, tokenId?: string, currency?: string): Promise<Value>

// Get total portfolio value
await vault.getTotalValue(currency?: string): Promise<Value>

// Force refresh portfolio value
await vault.updateTotalValue(currency?: string): Promise<Value>

// Set preferred currency
await vault.setCurrency(currency: string): Promise<void>
```

### Event Methods

```typescript
// Subscribe to event
vault.on(event: string, handler: Function): void

// Unsubscribe from event
vault.off(event: string, handler: Function): void
```

**Available events:**
- `balanceUpdated` - Balance fetched/updated
- `transactionSigned` - Transaction signature ready
- `transactionBroadcast` - Transaction broadcast complete
- `signingProgress` - Signing step updates
- `chainAdded` / `chainRemoved` - Chain management
- `tokenAdded` / `tokenRemoved` - Token management
- `saved` - Vault saved
- `renamed` - Vault renamed
- `error` - Error occurred

---

## Types

### AccountCoin

```typescript
interface AccountCoin {
  chain: Chain
  ticker: string
  address: string
  decimals: number
  id?: string              // Token contract address for non-native
  priceUSD?: string
  isNativeToken?: boolean
}
```

### SwapQuoteResult

```typescript
interface SwapQuoteResult {
  provider: string          // 'thorchain', '1inch', 'lifi', etc.
  estimatedOutput: string   // Expected output amount
  minimumOutput: string     // Minimum with slippage
  expiresAt: number         // Quote expiration timestamp
  fees: {
    network: string
    affiliate: string
    total: string
  }
  requiresApproval: boolean
  approvalInfo?: {
    spender: string
    amount: string
  }
}
```

### VaultCreationStep

```typescript
interface VaultCreationStep {
  step: string
  message: string
  progress: number  // 0-100
}
```

### SigningOptions (SecureVault)

```typescript
interface SigningOptions {
  signal?: AbortSignal
  onQRCodeReady?: (qrPayload: string) => void
  onDeviceJoined?: (deviceId: string, total: number, required: number) => void
  onProgress?: (step: { step: string, message: string }) => void
}
```
