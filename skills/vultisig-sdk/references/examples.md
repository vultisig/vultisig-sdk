# Code Examples

## Basic Setup

### Initialize SDK

```typescript
import { Vultisig, Chain } from '@vultisig/sdk'

const sdk = new Vultisig({
  // Password callback for encrypted vaults
  onPasswordRequired: async (vaultId, vaultName) => {
    // For AI agents, use environment variable
    return process.env.VAULT_PASSWORD || ''
  },
  // Cache password for 5 minutes
  passwordCache: { defaultTTL: 300000 }
})

await sdk.initialize()

// Always dispose when done
sdk.dispose()
```

### Create FastVault

```typescript
// Create vault (returns vaultId)
const vaultId = await sdk.createFastVault({
  name: 'trading-bot',
  email: 'bot@example.com',
  password: 'SecurePassword123!',
  onProgress: (step) => {
    console.log(`${step.message} (${step.progress}%)`)
  }
})

// Verify with email code
const code = '123456'  // From email
const vault = await sdk.verifyVault(vaultId, code)

console.log('Vault created:', vault.id)
```

### Import Existing Vault

```typescript
import * as fs from 'fs'

const vultContent = fs.readFileSync('backup.vult', 'utf-8')

// Check if encrypted
const isEncrypted = sdk.isVaultEncrypted(vultContent)

// Import
const vault = await sdk.importVault(
  vultContent,
  isEncrypted ? 'password' : undefined
)

console.log('Imported:', vault.name)
```

---

## Address Operations

### Get Single Address

```typescript
const ethAddress = await vault.address(Chain.Ethereum)
const btcAddress = await vault.address(Chain.Bitcoin)

console.log('ETH:', ethAddress)  // 0x...
console.log('BTC:', btcAddress)  // bc1q...
```

### Get Multiple Addresses

```typescript
const addresses = await vault.addresses([
  Chain.Bitcoin,
  Chain.Ethereum,
  Chain.Solana,
  Chain.Polygon
])

for (const [chain, address] of Object.entries(addresses)) {
  console.log(`${chain}: ${address}`)
}
```

---

## Balance Operations

### Check Single Balance

```typescript
const balance = await vault.balance(Chain.Ethereum)

console.log(`Balance: ${balance.amount} ${balance.symbol}`)
console.log(`Value: $${balance.fiatValue} ${balance.currency}`)
```

### Check Multiple Balances

```typescript
const balances = await vault.balances([
  Chain.Bitcoin,
  Chain.Ethereum,
  Chain.Solana
])

for (const [chain, balance] of Object.entries(balances)) {
  console.log(`${chain}: ${balance.amount} ${balance.symbol}`)
}
```

### Include Token Balances

```typescript
// Get native + ERC-20 token balances
const balances = await vault.balances([Chain.Ethereum], true)
```

### Force Refresh

```typescript
// Refresh single chain
await vault.updateBalance(Chain.Ethereum)

// Refresh all chains
await vault.updateBalances()
```

---

## Send Transactions

### Send Native Token (ETH)

```typescript
import { Chain, AccountCoin } from '@vultisig/sdk'

const ethAddress = await vault.address(Chain.Ethereum)

const coin: AccountCoin = {
  chain: Chain.Ethereum,
  ticker: 'ETH',
  address: ethAddress,
  decimals: 18,
  isNativeToken: true
}

// Prepare (0.1 ETH)
const payload = await vault.prepareSendTx({
  coin,
  receiver: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
  amount: '100000000000000000'  // 0.1 ETH in wei
})

// Sign
const signature = await vault.sign(payload)

// Broadcast
const txHash = await vault.broadcastTx({
  chain: Chain.Ethereum,
  keysignPayload: payload,
  signature
})

console.log('TX Hash:', txHash)
```

### Send ERC-20 Token (USDC)

```typescript
const coin: AccountCoin = {
  chain: Chain.Ethereum,
  ticker: 'USDC',
  address: await vault.address(Chain.Ethereum),
  decimals: 6,
  id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',  // USDC contract
  isNativeToken: false
}

const payload = await vault.prepareSendTx({
  coin,
  receiver: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
  amount: '100000000'  // 100 USDC (6 decimals)
})

const signature = await vault.sign(payload)
const txHash = await vault.broadcastTx({
  chain: Chain.Ethereum,
  keysignPayload: payload,
  signature
})
```

### Send Bitcoin

```typescript
const coin: AccountCoin = {
  chain: Chain.Bitcoin,
  ticker: 'BTC',
  address: await vault.address(Chain.Bitcoin),
  decimals: 8,
  isNativeToken: true
}

const payload = await vault.prepareSendTx({
  coin,
  receiver: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
  amount: '10000000'  // 0.1 BTC in satoshi
})

const signature = await vault.sign(payload)
const txHash = await vault.broadcastTx({
  chain: Chain.Bitcoin,
  keysignPayload: payload,
  signature
})
```

---

## Swap Operations

### Get Swap Quote

```typescript
// Simple format - native tokens
const quote = await vault.getSwapQuote({
  fromCoin: { chain: Chain.Ethereum },
  toCoin: { chain: Chain.Bitcoin },
  amount: 0.5  // 0.5 ETH
})

console.log(`Provider: ${quote.provider}`)
console.log(`Expected: ${quote.estimatedOutput} BTC`)
console.log(`Min output: ${quote.minimumOutput} BTC`)
console.log(`Fees: ${quote.fees.total}`)
```

### Execute Cross-Chain Swap (ETH → BTC)

```typescript
// 1. Get quote
const quote = await vault.getSwapQuote({
  fromCoin: { chain: Chain.Ethereum },
  toCoin: { chain: Chain.Bitcoin },
  amount: 0.1
})

// 2. Prepare transaction
const { keysignPayload } = await vault.prepareSwapTx({
  fromCoin: { chain: Chain.Ethereum },
  toCoin: { chain: Chain.Bitcoin },
  amount: 0.1,
  swapQuote: quote
})

// 3. Sign
const signature = await vault.sign(keysignPayload)

// 4. Broadcast
const txHash = await vault.broadcastTx({
  chain: Chain.Ethereum,
  keysignPayload,
  signature
})

console.log('Swap initiated:', txHash)
```

### Swap ERC-20 Tokens (with Approval)

```typescript
const ethAddress = await vault.address(Chain.Ethereum)

// 1. Get quote for USDC → ETH
const quote = await vault.getSwapQuote({
  fromCoin: {
    chain: Chain.Ethereum,
    token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'  // USDC
  },
  toCoin: { chain: Chain.Ethereum },
  amount: 100  // 100 USDC
})

// 2. Prepare swap
const { keysignPayload, approvalPayload } = await vault.prepareSwapTx({
  fromCoin: {
    chain: Chain.Ethereum,
    address: ethAddress,
    id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    ticker: 'USDC',
    decimals: 6
  },
  toCoin: { chain: Chain.Ethereum },
  amount: 100,
  swapQuote: quote
})

// 3. Handle approval if needed
if (approvalPayload) {
  const approvalSig = await vault.sign(approvalPayload)
  const approvalTx = await vault.broadcastTx({
    chain: Chain.Ethereum,
    keysignPayload: approvalPayload,
    signature: approvalSig
  })
  console.log('Approval TX:', approvalTx)
  // Wait for confirmation before proceeding
}

// 4. Execute swap
const signature = await vault.sign(keysignPayload)
const txHash = await vault.broadcastTx({
  chain: Chain.Ethereum,
  keysignPayload,
  signature
})

console.log('Swap TX:', txHash)
```

---

## Custom Transaction Signing

### Sign Arbitrary Bytes

```typescript
// Sign pre-hashed data for custom transactions
const signature = await vault.signBytes({
  data: '0xabcdef1234...',  // 32-byte hash
  chain: Chain.Ethereum
})

console.log('Signature:', signature.signature)
console.log('Recovery:', signature.recovery)
```

### Broadcast Raw Transaction

```typescript
// Broadcast externally-constructed transaction
const txHash = await vault.broadcastRawTx({
  chain: Chain.Ethereum,
  rawTx: '0x02f8...'  // Signed tx hex
})
```

---

## Event Handling

### Subscribe to Events

```typescript
// Balance updates
vault.on('balanceUpdated', ({ chain, tokenId }) => {
  console.log(`Balance updated: ${chain}`)
})

// Transaction lifecycle
vault.on('transactionSigned', ({ chain }) => {
  console.log(`Transaction signed on ${chain}`)
})

vault.on('transactionBroadcast', ({ chain, txHash }) => {
  console.log(`Broadcast on ${chain}: ${txHash}`)
})

// Signing progress
vault.on('signingProgress', ({ message, progress }) => {
  console.log(`${message} (${progress}%)`)
})
```

### Unsubscribe

```typescript
const handler = ({ chain }) => console.log(chain)
vault.on('balanceUpdated', handler)

// Later...
vault.off('balanceUpdated', handler)
```

---

## Error Handling

### Try-Catch Pattern

```typescript
import { VaultError, VaultErrorCode } from '@vultisig/sdk'

try {
  const signature = await vault.sign(payload)
} catch (error) {
  if (error instanceof VaultError) {
    switch (error.code) {
      case VaultErrorCode.PasswordRequired:
        console.log('Vault is locked')
        await vault.unlock(password)
        break
      case VaultErrorCode.InsufficientBalance:
        console.log('Not enough funds')
        break
      case VaultErrorCode.SigningFailed:
        console.log('Signing failed:', error.message)
        break
      default:
        console.log('Vault error:', error.message)
    }
  } else {
    throw error
  }
}
```

---

## Stateless Usage (No Persistence)

```typescript
import { Vultisig, MemoryStorage } from '@vultisig/sdk'
import * as fs from 'fs'

// Use memory storage for one-off operations
const sdk = new Vultisig({
  storage: new MemoryStorage()
})
await sdk.initialize()

// Load vault from file
const vultContent = fs.readFileSync('backup.vult', 'utf-8')
const vault = await sdk.importVault(vultContent, 'password')

// Perform operations
const address = await vault.address(Chain.Bitcoin)
const balance = await vault.balance(Chain.Ethereum)

// Data is not persisted when process ends
sdk.dispose()
```

---

## Complete Agent Example

```typescript
import { Vultisig, Chain, MemoryStorage } from '@vultisig/sdk'

async function runTradingBot() {
  // Initialize
  const sdk = new Vultisig({
    storage: new MemoryStorage(),
    onPasswordRequired: async () => process.env.VAULT_PASSWORD!
  })
  await sdk.initialize()

  // Load vault
  const vultContent = process.env.VAULT_FILE!
  const vault = await sdk.importVault(vultContent, process.env.VAULT_PASSWORD)

  // Check balances
  const ethBalance = await vault.balance(Chain.Ethereum)
  console.log(`ETH Balance: ${ethBalance.amount}`)

  // Execute swap if conditions met
  if (parseFloat(ethBalance.amount) > 0.1) {
    const quote = await vault.getSwapQuote({
      fromCoin: { chain: Chain.Ethereum },
      toCoin: { chain: Chain.Bitcoin },
      amount: 0.1
    })

    const { keysignPayload } = await vault.prepareSwapTx({
      fromCoin: { chain: Chain.Ethereum },
      toCoin: { chain: Chain.Bitcoin },
      amount: 0.1,
      swapQuote: quote
    })

    const signature = await vault.sign(keysignPayload)
    const txHash = await vault.broadcastTx({
      chain: Chain.Ethereum,
      keysignPayload,
      signature
    })

    console.log('Swap executed:', txHash)
  }

  sdk.dispose()
}

runTradingBot().catch(console.error)
```
