# Vultisig SDK

A TypeScript SDK for secure multi-party computation (MPC) and blockchain operations using the Vultisig protocol. Build secure, decentralized applications with threshold signature schemes and multi-chain support.

## Features

- 🔐 **Multi-Party Computation (MPC)** - Secure threshold signatures using DKLS and Schnorr protocols
- 🏦 **Fast Vault** - Server-assisted 2-of-2 vault for quick setup and instant signing
- 🛡️ **Secure Vault** - Multi-device N-of-M threshold signing with mobile device pairing
- 📲 **QR Code Pairing** - Pair with Vultisig mobile apps (iOS/Android) for vault creation and signing
- 🌐 **Multi-Chain Support** - Bitcoin, Ethereum, Solana, THORChain, and 40+ blockchains
- 🔗 **Address Derivation** - Generate addresses across multiple blockchain networks
- 📱 **Cross-Platform** - Works in browsers, Node.js, and Electron (React Native coming soon)
- 🔒 **Vault Management** - Import, export, encrypt, and decrypt vault keyshares
- 🔑 **Seedphrase Import** - Import existing BIP39 mnemonics with automatic chain discovery
- 💰 **VULT Discount Tiers** - Automatic swap fee discounts based on VULT token holdings
- 📋 **Token Registry** - Built-in known token database, fee coin lookup, and on-chain token discovery
- 🛡️ **Security Scanning** - Transaction validation/simulation via Blockaid, site phishing detection
- 💵 **Price Feeds** - Fetch token prices via CoinGecko
- 🏪 **Fiat On-Ramp** - Generate Banxa buy URLs for 23+ supported chains
- 🔔 **Push Notifications** - Real-time signing coordination via WebSocket or platform push (APNs, FCM, Web Push)
- 🌍 **WASM Integration** - High-performance cryptographic operations via WebAssembly

## Installation

```bash
npm install @vultisig/sdk
```

## Quick Start

### 1. Initialize the SDK

```typescript
import { Vultisig } from '@vultisig/sdk'

// Storage is auto-configured for your platform:
// - Node.js/Electron: FileStorage (~/.vultisig)
// - Browser: BrowserStorage (IndexedDB)
const sdk = new Vultisig()

// Initialize WASM modules
await sdk.initialize()
```

> **WARNING — Vault Persistence:** Do **not** use `MemoryStorage` in production. It is non-persistent — all vault keyshares are lost when the process exits, resulting in **permanent loss of funds**. The SDK auto-configures persistent storage for your platform. Always back up vaults with `vault.export()`.

### 2. Create a Fast Vault (Server-Assisted)

```typescript
// Create a new vault using VultiServer
const vaultId = await sdk.createFastVault({
  name: "My Secure Wallet",
  email: "user@example.com",
  password: "SecurePassword123!",
});

// User will receive a verification code via email
const code = "1234"; // Get from user input
const vault = await sdk.verifyVault(vaultId, code);
```

### 3. Derive Blockchain Addresses

```typescript
// Derive addresses for different blockchain networks
const btcAddress = await vault.address("Bitcoin");
const ethAddress = await vault.address("Ethereum");
const solAddress = await vault.address("Solana");

console.log("BTC:", btcAddress); // bc1q...
console.log("ETH:", ethAddress); // 0x...
console.log("SOL:", solAddress); // 9WzD...
```

### 4. Create a Secure Vault (Multi-Device)

```typescript
// Create a secure vault with 2-of-3 threshold
const { vault, vaultId, sessionId } = await sdk.createSecureVault({
  name: "Team Wallet",
  devices: 3,                    // Total number of devices
  threshold: 2,                  // Optional: defaults to ceil((devices+1)/2)
  password: "optional-password", // Optional: encrypt the vault
  onQRCodeReady: (qrPayload) => {
    // Display this QR code for other devices to scan with Vultisig app
    displayQRCode(qrPayload);
  },
  onDeviceJoined: (deviceId, totalJoined, required) => {
    console.log(`Device joined: ${totalJoined}/${required}`);
  },
  onProgress: (step) => {
    console.log(`${step.step}: ${step.message}`);
  }
});

console.log("Vault created:", vault.name);
```

### 5. Sign with Secure Vault

```typescript
// Signing requires coordination with other devices
await vault.sign(transactionPayload, {
  onQRCodeReady: (qrPayload) => {
    // Display QR for devices to join the signing session
    displayQRCode(qrPayload);
  },
  onDeviceJoined: (deviceId, total, required) => {
    console.log(`Signing: ${total}/${required} devices ready`);
  },
  onProgress: (step) => {
    console.log(`Signing progress: ${step.message}`);
  }
});
```

### 6. Import/Export Vaults

```typescript
// Check if a vault file is encrypted
const isEncrypted = await sdk.isVaultFileEncrypted(file);

// Import vault from file
const vault = await sdk.addVault(file, isEncrypted ? "password" : undefined);

// Export vault to backup format (as Blob)
const backupBlob = await vault.export("BackupPassword123!");

// Or export as base64 string
const backupBase64 = await vault.exportAsBase64("BackupPassword123!");
```

### 7. Create Vault from Seedphrase

Import an existing wallet from a BIP39 mnemonic. Supports all 10 BIP39 languages with automatic detection:

```typescript
// Validate the seedphrase first (auto-detects language)
const validation = await sdk.validateSeedphrase(mnemonic)
if (!validation.valid) {
  console.error(validation.error)
  return
}
console.log(`Detected language: ${validation.detectedLanguage}`) // 'english', 'japanese', etc.

// Discover which chains have balances
const chains = await sdk.discoverChainsFromSeedphrase(
  mnemonic,
  [Chain.Bitcoin, Chain.Ethereum, Chain.THORChain],
  (progress) => console.log(`${progress.chain}: ${progress.phase}`)
)

for (const result of chains) {
  if (result.hasBalance) {
    console.log(`${result.chain}: ${result.balance} ${result.symbol}`)
  }
}

// Create FastVault from seedphrase (requires email verification)
const vaultId = await sdk.createFastVaultFromSeedphrase({
  mnemonic,
  name: 'Imported Wallet',
  email: 'user@example.com',
  password: 'SecurePassword123!',
  discoverChains: true, // Auto-enable chains with balances
  onProgress: (step) => console.log(step.message)
})

// Verify with email code
const vault = await sdk.verifyVault(vaultId, verificationCode)
```

### 8. Token Registry & Prices

```typescript
import { Vultisig, Chain, CosmosMsgType } from '@vultisig/sdk'

// Look up known tokens (static, no vault needed)
const tokens = Vultisig.getKnownTokens(Chain.Ethereum)
const usdc = Vultisig.getKnownToken(Chain.Ethereum, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

// Get native fee coin info
const feeCoin = Vultisig.getFeeCoin(Chain.Bitcoin) // { ticker: 'BTC', decimals: 8, ... }

// Fetch prices
const prices = await Vultisig.getCoinPrices({ ids: ['bitcoin', 'ethereum'] })
console.log(`BTC: $${prices.bitcoin}`)

// Discover tokens at vault address
const discovered = await vault.discoverTokens(Chain.Ethereum)

// Resolve token metadata (known registry → chain API fallback)
const token = await vault.resolveToken(Chain.Ethereum, '0x...')

// Cosmos message type constants
const msgType = CosmosMsgType.MsgSend // 'cosmos-sdk/MsgSend'
```

### 9. Security Scanning

```typescript
// Scan a website for phishing (static, no vault needed)
const siteScan = await Vultisig.scanSite('https://suspicious-site.com')
if (siteScan.isMalicious) console.warn('Malicious site!')

// Validate a transaction before signing
const validation = await vault.validateTransaction(keysignPayload)
if (validation?.isRisky) {
  console.warn(`Risk: ${validation.riskLevel} - ${validation.description}`)
}

// Simulate a transaction to preview asset changes
const simulation = await vault.simulateTransaction(keysignPayload)
```

### 10. Fiat On-Ramp (Banxa)

```typescript
// Check supported chains
const chains = Vultisig.getBanxaSupportedChains() // 23+ chains

// Generate buy URL for vault address
const buyUrl = await vault.getBuyUrl(Chain.Bitcoin)
if (buyUrl) window.open(buyUrl)
```

### 11. Push Notifications

Coordinate multi-party signing by notifying vault members when a signing session is initiated.

```typescript
// Step 1: Register device for vault notifications
// Token comes from your platform's push service (APNs, FCM, or Web Push)
await sdk.notifications.registerDevice({
  vaultId: vault.publicKeys.ecdsa,
  partyName: vault.localPartyId,
  token: myPlatformPushToken,
  deviceType: 'ios', // 'ios' | 'android' | 'web'
})

// Step 2: Notify other vault members when initiating a signing session
await sdk.notifications.notifyVaultMembers({
  vaultId: vault.publicKeys.ecdsa,
  vaultName: vault.name,
  localPartyId: vault.localPartyId,
  qrCodeData: keysignQrPayload, // session data for joining
})

// Step 3: Handle incoming push notifications
const unsubscribe = sdk.notifications.onSigningRequest((notification) => {
  console.log(`Signing request for vault: ${notification.vaultName}`)
  // Use notification.qrCodeData to join the signing session
})
```

#### Consumer Responsibilities

The SDK handles server communication and state management. Your application is responsible for platform-specific push integration:

| Responsibility | Owner | Details |
|---|---|---|
| Obtain push token | **You** | Use platform APIs (APNs, FCM, Web Push) to get a device token |
| Register token with server | SDK | `sdk.notifications.registerDevice()` |
| Send notification to vault members | SDK | `sdk.notifications.notifyVaultMembers()` |
| Wire platform push handler | **You** | iOS delegate, FCM onMessage, service worker, etc. |
| Parse incoming notification | SDK | `sdk.notifications.handleIncomingPush(data)` |
| Display notification to user | **You** | OS notification, in-app alert, etc. |
| Route user to signing flow | **You** | Use `qrCodeData` from the parsed notification |
| Persist registration state | SDK | Stored automatically in SDK storage |

#### Platform Setup

**iOS** — Register for remote notifications, pass APNs device token:
```typescript
// In your AppDelegate / UNUserNotificationCenter handler:
sdk.notifications.handleIncomingPush(notification.userInfo)
```

**Android** — Use Firebase Cloud Messaging:
```typescript
// In your FirebaseMessagingService.onMessageReceived:
sdk.notifications.handleIncomingPush(remoteMessage.data)
```

**Browser / Extension** — Use WebSocket for real-time delivery (no service worker needed):
```typescript
// Register device
await sdk.notifications.registerDevice({
  vaultId: vault.publicKeys.ecdsa,
  partyName: vault.localPartyId,
  token: myDeviceToken,
  deviceType: 'web',
})

// Connect WebSocket — notifications delivered via onSigningRequest()
sdk.notifications.connect({
  vaultId: vault.publicKeys.ecdsa,
  partyName: vault.localPartyId,
  token: myDeviceToken,
})

// Disconnect when done (also called by sdk.dispose())
sdk.notifications.disconnect()
```

Alternatively, use Web Push API with VAPID key:
```typescript
const vapidKey = await sdk.notifications.fetchVapidPublicKey()
const subscription = await registration.pushManager.subscribe({
  userVisibleOnly: true,
  applicationServerKey: vapidKey,
})
await sdk.notifications.registerDevice({
  vaultId: vault.publicKeys.ecdsa,
  partyName: vault.localPartyId,
  token: JSON.stringify(subscription.toJSON()),
  deviceType: 'web',
})

// In your service worker push event:
sdk.notifications.handleIncomingPush(event.data.json())
```

**Node.js / CLI** — Use WebSocket delivery (`connect()`) or `parseNotificationPayload()` manually if you implement your own transport.

## Supported Blockchains

The SDK supports address derivation and operations for 40+ blockchain networks:

| Network   | Chain ID    | Description         |
| --------- | ----------- | ------------------- |
| Bitcoin   | `bitcoin`   | Bitcoin mainnet     |
| Ethereum  | `ethereum`  | Ethereum mainnet    |
| Solana    | `solana`    | Solana mainnet      |
| THORChain | `thorchain` | THORChain mainnet   |
| Polygon   | `polygon`   | Polygon (MATIC)     |
| Avalanche | `avalanche` | Avalanche C-Chain   |
| BSC       | `bsc`       | Binance Smart Chain |
| Arbitrum  | `arbitrum`  | Arbitrum One        |
| Optimism  | `optimism`  | Optimism mainnet    |
| Cosmos    | `cosmos`    | Cosmos Hub          |
| Litecoin  | `litecoin`  | Litecoin mainnet    |
| Dogecoin  | `dogecoin`  | Dogecoin mainnet    |
| ...       | ...         | And many more       |

## Vault Types

The SDK supports two vault types for different security and usability requirements:

| Feature | Fast Vault | Secure Vault |
|---------|------------|--------------|
| **Threshold** | 2-of-2 | N-of-M (configurable) |
| **Setup** | Server-assisted, instant | Multi-device, requires pairing |
| **Signing** | Instant via VultiServer | Requires device coordination |
| **Use Cases** | Personal wallets, quick setup | Team wallets, high security, custody |
| **Device Pairing** | None required | QR code with Vultisig mobile app |
| **Password** | Required | Optional |

### When to Use Each Type

**Fast Vault** - Best for:
- Individual users wanting quick setup
- Development and testing
- Situations where server-assisted signing is acceptable

**Secure Vault** - Best for:
- Team or organizational wallets
- High-value assets requiring multi-party approval
- Scenarios requiring configurable thresholds (2-of-3, 3-of-5, etc.)
- Maximum security without server dependency during signing

## Framework Integration Example

The SDK works with any JavaScript framework. Here's a React example:

### React Component Example

```typescript
import { Vultisig } from '@vultisig/sdk'
import type { VaultBase } from '@vultisig/sdk'
import { useState, useEffect } from 'react'

function VaultApp() {
  // BrowserStorage (IndexedDB) is used automatically in browser environments
  const [sdk] = useState(() => new Vultisig())
  const [vault, setVault] = useState<VaultBase | null>(null)
  const [addresses, setAddresses] = useState<Record<string, string>>({})

  useEffect(() => {
    // Initialize SDK on component mount
    sdk.initialize().catch(console.error)
  }, [sdk])

  const createVault = async () => {
    try {
      const vaultId = await sdk.createFastVault({
        name: 'My Wallet',
        email: 'user@example.com',
        password: 'SecurePassword123!'
      })

      // User receives verification code via email
      const code = prompt('Enter verification code from email:')
      const vault = await sdk.verifyVault(vaultId, code!)
      setVault(vault)
    } catch (error) {
      console.error('Vault creation failed:', error)
    }
  }

  const deriveAddresses = async () => {
    if (!vault) return

    const chains = ['Bitcoin', 'Ethereum', 'Solana']
    const results: Record<string, string> = {}

    for (const chain of chains) {
      try {
        results[chain] = await vault.address(chain)
      } catch (error) {
        console.error(`Failed to derive ${chain} address:`, error)
      }
    }

    setAddresses(results)
  }

  return (
    <div>
      <h1>Vultisig SDK Demo</h1>

      {!vault && (
        <button onClick={createVault}>
          Create Fast Vault
        </button>
      )}

      {vault && (
        <div>
          <h2>Vault: {vault.name}</h2>
          <p>Local Party: {vault.localPartyId}</p>

          <button onClick={deriveAddresses}>
            Derive Addresses
          </button>

          {Object.keys(addresses).length > 0 && (
            <div>
              <h3>Addresses</h3>
              {Object.entries(addresses).map(([chain, address]) => (
                <div key={chain}>
                  <strong>{chain.toUpperCase()}:</strong> {address}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default VaultApp
```

## Configuration

### SDK Configuration

```typescript
const sdk = new Vultisig({
  autoInit: true, // Automatically initialize WASM modules on creation
  serverUrl: "https://api.vultisig.com", // Custom VultiServer endpoint
  relayUrl: "https://relay.vultisig.com", // Custom relay endpoint
});
```

### WASM Files

The SDK requires three WASM files to be available in your application's public directory:

- `wallet-core.wasm` - Trust Wallet Core for address derivation
- `dkls.wasm` - ECDSA threshold signatures (DKLS protocol)
- `schnorr.wasm` - EdDSA threshold signatures (Schnorr protocol)

For bundled applications (Vite, webpack, etc.), place these files in the `public/` directory.

## API Reference

### Core Methods

#### `initialize(): Promise<void>`

Initialize the SDK and load all WASM modules.

#### `createFastVault(options): Promise<string>`

Create a new vault using VultiServer assistance. Returns the vaultId.

**Parameters:**

- `options.name: string` - Vault name
- `options.email: string` - Email for verification
- `options.password: string` - Vault encryption password

#### `verifyVault(vaultId, code): Promise<FastVault>`

Verify vault creation with email verification code. Returns the verified vault.

#### `createSecureVault(options): Promise<{ vault, vaultId, sessionId }>`

Create a multi-device secure vault with N-of-M threshold signing.

**Parameters:**

- `options.name: string` - Vault name
- `options.devices: number` - Number of devices participating (minimum 2)
- `options.threshold?: number` - Signing threshold (defaults to ceil((devices+1)/2))
- `options.password?: string` - Optional vault encryption password
- `options.onQRCodeReady?: (qrPayload: string) => void` - Called when QR code is ready for device pairing
- `options.onDeviceJoined?: (deviceId: string, total: number, required: number) => void` - Called when a device joins
- `options.onProgress?: (step: VaultCreationStep) => void` - Called with creation progress updates

**Returns:**

- `vault: SecureVault` - The created vault instance
- `vaultId: string` - Unique vault identifier
- `sessionId: string` - Session ID used for creation

#### `validateSeedphrase(mnemonic): Promise<SeedphraseValidation>`

Validate a BIP39 mnemonic phrase.

**Returns:**
- `valid: boolean` - Whether the mnemonic is valid
- `wordCount: number` - Number of words (12 or 24)
- `invalidWords?: string[]` - Words not in BIP39 wordlist
- `error?: string` - Error message if invalid

#### `discoverChainsFromSeedphrase(mnemonic, chains?, onProgress?): Promise<ChainDiscoveryResult[]>`

Discover chains with balances for a seedphrase.

**Parameters:**
- `mnemonic: string` - BIP39 mnemonic phrase
- `chains?: Chain[]` - Chains to scan (defaults to common chains)
- `onProgress?: (progress: ChainDiscoveryProgress) => void` - Progress callback

#### `createFastVaultFromSeedphrase(options): Promise<string>`

Create a FastVault from a BIP39 seedphrase. Returns vaultId for email verification.

**Parameters:**
- `options.mnemonic: string` - BIP39 mnemonic (12 or 24 words)
- `options.name: string` - Vault name
- `options.email: string` - Email for verification
- `options.password: string` - Vault encryption password
- `options.discoverChains?: boolean` - Auto-enable chains with balances
- `options.onProgress?: (step: VaultCreationStep) => void` - Progress callback
- `options.onChainDiscovery?: (progress: ChainDiscoveryProgress) => void` - Discovery callback

#### `createSecureVaultFromSeedphrase(options): Promise<{ vault, vaultId, sessionId }>`

Create a SecureVault from a BIP39 seedphrase with multi-device MPC.

**Parameters:**
- `options.mnemonic: string` - BIP39 mnemonic (12 or 24 words)
- `options.name: string` - Vault name
- `options.devices: number` - Number of participating devices
- `options.threshold?: number` - Signing threshold
- `options.password?: string` - Optional encryption password
- `options.onQRCodeReady?: (qrPayload: string) => void` - QR callback
- `options.onDeviceJoined?: (deviceId, total, required) => void` - Device join callback

#### `joinSecureVault(qrPayload, options): Promise<{ vault, vaultId }>`

Join an existing SecureVault creation session. Auto-detects keygen vs seedphrase mode.

**Parameters:**
- `qrPayload: string` - QR code content from initiator (vultisig://...)
- `options.mnemonic?: string` - Required for seedphrase-based sessions, ignored for keygen
- `options.devices: number` - Number of participating devices (required)
- `options.password?: string` - Optional encryption password
- `options.onProgress?: (step: VaultCreationStep) => void` - Progress callback
- `options.onDeviceJoined?: (deviceId, total, required) => void` - Device join callback

#### `vault.address(chain): Promise<string>`

Derive a blockchain address for the given chain (called on Vault instance).

#### `addVault(file, password?): Promise<Vault>`

Import a vault from a backup file.

#### `vault.export(password?): Promise<Blob>`

Export a vault to encrypted backup format as a Blob (called on Vault instance).

#### `vault.exportAsBase64(password?): Promise<string>`

Export a vault to encrypted backup format as a base64 string (called on Vault instance).

#### `secureVault.sign(payload, options?): Promise<SigningResult>`

Sign a transaction with a SecureVault (requires device coordination).

**Parameters:**

- `payload: SigningPayload` - Transaction data to sign
- `options.signal?: AbortSignal` - Optional signal to cancel the signing operation
- `options.onQRCodeReady?: (qrPayload: string) => void` - Called when QR code is ready for device pairing
- `options.onDeviceJoined?: (deviceId: string, total: number, required: number) => void` - Called when a device joins
- `options.onProgress?: (step: SigningStep) => void` - Called with signing progress updates

#### `secureVault.signBytes(options, signingOptions?): Promise<SigningResult>`

Sign arbitrary bytes with a SecureVault.

**Parameters:**

- `options.chain: string` - Chain for signature algorithm selection
- `options.messages: (Uint8Array | Buffer | string)[]` - Messages to sign (hex strings or bytes)
- `signingOptions.signal?: AbortSignal` - Optional signal to cancel the operation

### Static Methods (No Vault Needed)

#### `Vultisig.getKnownTokens(chain): TokenInfo[]`

Get all known tokens for a chain from the built-in registry.

#### `Vultisig.getKnownToken(chain, contractAddress): TokenInfo | null`

Look up a specific token by contract address (case-insensitive). Returns null if not found.

#### `Vultisig.getFeeCoin(chain): FeeCoinInfo`

Get the native fee coin info for a chain (e.g., ETH for Ethereum, BTC for Bitcoin).

#### `Vultisig.getCoinPrices(params): Promise<Record<string, number>>`

Fetch current token prices by CoinGecko IDs.

**Parameters:**
- `params.ids: string[]` - CoinGecko price provider IDs
- `params.fiatCurrency?: string` - Fiat currency code (default: `'usd'`)

#### `Vultisig.getBanxaSupportedChains(): Chain[]`

Get the list of chains supported by the Banxa fiat on-ramp.

#### `Vultisig.scanSite(url): Promise<SiteScanResult>`

Scan a website URL for malicious content via Blockaid.

**Returns:**
- `isMalicious: boolean` - Whether the site is flagged as malicious
- `url: string` - The scanned URL

### Vault Methods (Token Discovery & Security)

#### `vault.discoverTokens(chain): Promise<DiscoveredToken[]>`

Discover tokens with non-zero balances at this vault's address. Supported: EVM (via 1inch), Solana (via Jupiter), Cosmos (via RPC).

#### `vault.resolveToken(chain, contractAddress): Promise<TokenInfo>`

Resolve token metadata by contract address. Checks known tokens registry first, then resolves from chain APIs.

#### `vault.getBuyUrl(chain, ticker?): Promise<string | null>`

Generate a Banxa fiat on-ramp URL for buying crypto to this vault's address. Returns null if chain is not supported by Banxa.

#### `vault.validateTransaction(keysignPayload): Promise<TransactionValidationResult | null>`

Validate a transaction for security risks before signing using Blockaid. Supported: EVM chains, Solana, Sui, Bitcoin. Returns null for unsupported chains.

#### `vault.simulateTransaction(keysignPayload): Promise<TransactionSimulationResult | null>`

Simulate a transaction to preview asset changes before signing. Supported: EVM chains, Solana. Returns null for unsupported chains.

### Transaction Status

#### `vault.getTxStatus(params): Promise<TxStatusResult>`

Check the on-chain status of a previously broadcast transaction. Supports all chain types.

**Parameters:**

- `params.chain: Chain` - The blockchain the transaction was broadcast on
- `params.txHash: string` - The transaction hash to check

**Returns:**

- `status: 'pending' | 'success' | 'error'` - Current transaction status
- `receipt?: TxReceiptInfo` - Fee details if available (`feeAmount`, `feeDecimals`, `feeTicker`)

**Example:**

```typescript
const txHash = await vault.broadcastTx({ chain, keysignPayload, signature })

// Poll for confirmation
const result = await vault.getTxStatus({ chain: Chain.Ethereum, txHash })
if (result.status === 'success') {
  console.log(`Confirmed! Fee: ${result.receipt?.feeAmount} ${result.receipt?.feeTicker}`)
} else if (result.status === 'error') {
  console.log('Transaction failed')
}
```

Emits `transactionConfirmed` or `transactionFailed` events for terminal states.

### Push Notification Methods

Accessed via `sdk.notifications`:

#### `notifications.registerDevice(options): Promise<void>`

Register a device to receive push notifications for a vault.

**Parameters:**
- `options.vaultId: string` - Vault ID (`publicKeys.ecdsa`)
- `options.partyName: string` - Local party ID of the device
- `options.token: string` - Push token from APNs, FCM, or Web Push
- `options.deviceType: 'ios' | 'android' | 'web'` - Platform type

#### `notifications.unregisterVault(vaultId): Promise<void>`

Remove local push registration for a vault.

#### `notifications.notifyVaultMembers(options): Promise<void>`

Send a push notification to all other registered devices for a vault.

**Parameters:**
- `options.vaultId: string` - Vault ID
- `options.vaultName: string` - Vault display name
- `options.localPartyId: string` - Sender's party ID (excluded from recipients)
- `options.qrCodeData: string` - Keysign session data for joining

#### `notifications.onSigningRequest(handler): () => void`

Register a callback for incoming signing notifications. Returns an unsubscribe function.

#### `notifications.handleIncomingPush(data): void`

Process raw push notification data from a platform handler. Parses and invokes registered callbacks.

#### `notifications.parseNotificationPayload(data): SigningNotification | null`

Parse raw push data into a typed `SigningNotification`. Returns null if data doesn't match expected format.

#### `notifications.fetchVapidPublicKey(): Promise<string>`

Fetch the VAPID public key for Web Push subscriptions. Only needed for `deviceType: 'web'`.

#### `notifications.isVaultRegistered(vaultId): Promise<boolean>`

Check if a vault is registered locally for push notifications.

#### `notifications.hasRemoteRegistrations(vaultId): Promise<boolean>`

Check if any devices are registered for a vault on the server.

#### `notifications.connect(options): void`

Open a WebSocket connection for real-time notification delivery. Messages are dispatched through `onSigningRequest()` callbacks. Auto-reconnects with exponential backoff (1s → 30s cap). Requires prior `registerDevice()` call.

**Parameters:**
- `options.vaultId: string` - Vault ID (`publicKeys.ecdsa`)
- `options.partyName: string` - Local party ID of the device
- `options.token: string` - Same token used for `registerDevice()`

#### `notifications.disconnect(): void`

Close the WebSocket connection and stop auto-reconnect. Also called automatically by `sdk.dispose()`.

#### `notifications.connectionState: WSConnectionState`

Current WebSocket state: `'disconnected'` | `'connecting'` | `'connected'` | `'reconnecting'`

#### `notifications.onConnectionStateChange(handler): () => void`

Register a callback for WebSocket connection state changes. Returns an unsubscribe function.

#### `notifications.ping(): Promise<boolean>`

Check if the notification server is reachable.

### Utility Methods

#### `isVaultFileEncrypted(file): Promise<boolean>`

Check if a vault backup file is encrypted.

#### `validateVault(vault): VaultValidationResult`

Validate vault structure and integrity.

#### `getVaultDetails(vault): VaultDetails`

Get vault metadata and information.

## Error Handling

The SDK throws descriptive errors that you can catch and handle:

```typescript
try {
  const vault = await sdk.createFastVault({
    name: "Test Vault",
    email: "invalid-email",
    password: "123",
  });
} catch (error) {
  if (error.message.includes("email")) {
    console.error("Invalid email address");
  } else if (error.message.includes("password")) {
    console.error("Password too weak");
  } else {
    console.error("Vault creation failed:", error);
  }
}
```

## Examples

See the `/examples` directory for complete sample applications:

- **Browser Example** - Complete web application with vault creation, import, and address derivation
- **Node.js Example** - Server-side vault operations and blockchain interactions

## Requirements

- Node.js 20+
- Modern browser with WebAssembly support
- Electron 20+ (for desktop applications)
- Network access for VultiServer communication (for Fast Vault features)

## Security Considerations

- **Private Keys**: The SDK uses threshold signatures - private keys are never stored in a single location
- **Encryption**: Vault keyshares are encrypted using AES-GCM with user-provided passwords
- **Server Trust**: Fast Vaults use VultiServer as one party in the MPC protocol
- **Secure Vault Independence**: Secure Vaults only use the relay server for coordination, not signing
- **Configurable Thresholds**: Secure Vaults support custom M-of-N thresholds for multi-party approval
- **WASM Integrity**: Ensure WASM files are served from trusted sources

## Development

### Prerequisites

- Node.js 20+
- Yarn 4.x

### Setup

This SDK is part of a monorepo. **Always install dependencies from the root directory:**

```bash
# Clone the repository
git clone https://github.com/vultisig/vultisig-sdk.git
cd vultisig-sdk

# IMPORTANT: Install from root (sets up all workspace packages)
yarn install
```

### Building

The SDK bundles functionality from workspace packages (`packages/core/` and `packages/lib/`) into a single distributable package.

```bash
# Build the SDK (from root directory)
yarn workspace @vultisig/sdk build
```

This creates the distributable package in `packages/sdk/dist/` with all dependencies bundled.

### Testing

```bash
# Run tests (from root directory)
yarn workspace @vultisig/sdk test
```

### Development Workflow

1. **Make changes** to SDK code in `packages/sdk/src/` or workspace packages in `packages/core/`/`packages/lib/`
2. **Build**: `yarn workspace @vultisig/sdk build`
3. **Test**: `yarn workspace @vultisig/sdk test`
4. **Lint**: `yarn lint` (from root)

### Project Structure

```
packages/sdk/
├── src/                # SDK source code
│   ├── chains/        # Address derivation and chain management
│   ├── mpc/           # Multi-party computation logic
│   ├── vault/         # Vault creation and management
│   ├── server/        # Fast vault server integration
│   └── wasm/          # WASM module management
├── tests/             # Test suite
└── package.json       # SDK package configuration

# Workspace packages (bundled into SDK)
packages/core/         # Core blockchain functionality
packages/lib/          # Shared libraries and utilities
```

## Contributing

1. Fork the repository
2. Install dependencies from root: `yarn install`
3. Make your changes in `packages/sdk/src/` or workspace packages
4. Run tests: `yarn workspace @vultisig/sdk test`
5. Build: `yarn workspace @vultisig/sdk build`
6. Submit a pull request

## License

MIT License - see [LICENSE](./LICENSE) file for details.

## Support

- 📖 [Documentation](https://docs.vultisig.com)
- 💬 [Discord Community](https://discord.gg/vultisig)
- 🐛 [Report Issues](https://github.com/vultisig/vultisig-sdk/issues)
- 🌐 [Website](https://vultisig.com)

---

**Built with ❤️ by the Vultisig team**
