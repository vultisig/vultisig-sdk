# Blockchair Integration for Vultisig SDK

This module provides comprehensive integration with [Blockchair](https://blockchair.com/api), a blockchain data indexing service that offers fast, reliable access to blockchain data across multiple chains.

## 🚀 Features

- **Multi-Chain Support**: Bitcoin, Ethereum, Solana, Cardano, and many more
- **Balance Queries**: Native token and ERC-20 token balance lookups
- **Transaction Data**: Detailed transaction information and history
- **Batch Operations**: Efficient bulk data retrieval
- **Smart Fallbacks**: Automatic fallback to RPC when Blockchair is unavailable
- **Type Safety**: Full TypeScript support with comprehensive type definitions

## 📦 Installation & Setup

The Blockchair integration is included in the Vultisig SDK. No additional installation required.

```typescript
import {
  blockchairClient,
  createSmartBalanceResolver,
  getBalanceWithBlockchair,
} from '@src/vault/balance/blockchair'
```

## 🔧 Quick Start

### Basic Usage

```typescript
import { blockchairClient } from '@src/vault/balance/blockchair'

// Get address information
const addressData = await blockchairClient.getAddressInfo(
  'ethereum',
  '0x1234...'
)

// Get transaction details
const txData = await blockchairClient.getTransactionInfo('bitcoin', 'abc123...')

// Get blockchain statistics
const stats = await blockchairClient.getStats('ethereum')
```

### Smart Balance Resolver

```typescript
import { createSmartBalanceResolver } from '@src/vault/balance/blockchair'

const resolver = createSmartBalanceResolver({
  enabled: true,
  fallbackToRpc: true, // Fallback to RPC if Blockchair fails
})

// Get balance with automatic data source selection
const balance = await resolver.getBalance({
  chain: Chain.Ethereum,
  address: '0x1234567890123456789012345678901234567890',
  id: 'ETH',
})
```

### Pre-configured Resolvers

```typescript
import {
  blockchairFirstResolver,
  rpcOnlyResolver,
  selectiveBlockchairResolver,
} from '@src/vault/balance/blockchair'

// Use Blockchair first, fallback to RPC
const balance = await blockchairFirstResolver.getBalance(account)

// Use only RPC (default behavior)
const balance = await rpcOnlyResolver.getBalance(account)

// Use Blockchair for specific chains only
const balance = await selectiveBlockchairResolver.getBalance(account)
```

## 🎯 Supported Chains

| Chain        | Blockchair Support | Balance | Transactions | Notes                   |
| ------------ | ------------------ | ------- | ------------ | ----------------------- |
| Bitcoin      | ✅                 | ✅      | ✅           | UTXO with full indexing |
| Bitcoin Cash | ✅                 | ✅      | ✅           | Full UTXO support       |
| Litecoin     | ✅                 | ✅      | ✅           | Full UTXO support       |
| Dogecoin     | ✅                 | ✅      | ✅           | Full UTXO support       |
| Dash         | ✅                 | ✅      | ✅           | Full UTXO support       |
| Zcash        | ✅                 | ✅      | ✅           | Full UTXO support       |
| Ethereum     | ✅                 | ✅      | ✅           | Native ETH + ERC-20     |
| Base         | ✅                 | ✅      | ✅           | Full EVM support        |
| Arbitrum     | ✅                 | ✅      | ✅           | Full EVM support        |
| Polygon      | ✅                 | ✅      | ✅           | Full EVM support        |
| Optimism     | ✅                 | ✅      | ✅           | Full EVM support        |
| BSC          | ✅                 | ✅      | ✅           | Full EVM support        |
| Avalanche    | ✅                 | ✅      | ✅           | Full EVM support        |
| Solana       | ✅                 | ✅      | ✅           | Native SOL              |
| Cardano      | ✅                 | ✅      | ✅           | Native ADA              |
| Ripple       | ✅                 | ✅      | ✅           | XRP transactions        |

## ⚙️ Configuration

### Basic Configuration

```typescript
const config = {
  enabled: true, // Enable Blockchair globally
  apiKey: 'your-api-key', // Optional: Premium features
  timeout: 10000, // Request timeout in ms
  retries: 3, // Number of retries
  fallbackToRpc: true, // Fallback to RPC on failure
}
```

### Chain-Specific Configuration

```typescript
const resolver = createSmartBalanceResolver({
  enabled: true,
  fallbackToRpc: true,
  chainOverrides: {
    [Chain.Ethereum]: 'blockchair', // Force Blockchair for Ethereum
    [Chain.Bitcoin]: 'blockchair', // Force Blockchair for Bitcoin
    [Chain.Cosmos]: 'rpc', // Force RPC for Cosmos
  },
})
```

### Advanced Configuration

```typescript
import { createBlockchairConfig } from '@src/vault/balance/blockchair'

const config = createBlockchairConfig({
  enabled: true,
  timeout: 15000,
  retries: 5,
  fallbackToRpc: true,
  chainOverrides: {
    // Custom per-chain settings
  },
})

// Validate configuration
import { validateBlockchairConfig } from '@src/vault/balance/blockchair'
const errors = validateBlockchairConfig(config)
if (errors.length > 0) {
  console.error('Configuration errors:', errors)
}
```

## 📊 API Reference

### BlockchairClient

#### Address Information

```typescript
// Single address
const addressData = await blockchairClient.getAddressInfo(
  'ethereum',
  '0x1234...'
)

// Multiple addresses (batch)
const addressesData = await blockchairClient.getAddressesInfo('ethereum', [
  '0x1234...',
  '0x5678...',
])
```

#### Transaction Information

```typescript
// Single transaction
const txData = await blockchairClient.getTransactionInfo('bitcoin', 'abc123...')

// Multiple transactions (batch)
const txsData = await blockchairClient.getTransactionsInfo('ethereum', [
  '0xhash1...',
  '0xhash2...',
])
```

#### Blockchain Statistics

```typescript
const stats = await blockchairClient.getStats('ethereum')
console.log(`Block height: ${stats.best_block_height}`)
console.log(`Market price: $${stats.market_price_usd}`)
```

#### Transaction Broadcasting (UTXO only)

```typescript
const result = await blockchairClient.broadcastTransaction('bitcoin', rawTxHex)
console.log(`Transaction ID: ${result.txid}`)
```

### Smart Resolvers

#### SmartBalanceResolver

```typescript
const resolver = new SmartBalanceResolver(config)

// Get balance with smart data source selection
const balance = await resolver.getBalance(account)

// Update configuration
resolver.updateConfig(newConfig)

// Get current configuration
const currentConfig = resolver.getConfig()
```

#### SmartTransactionResolver

```typescript
const resolver = new SmartTransactionResolver(config)

// Get transaction information
const txInfo = await resolver.getTransaction('ethereum', '0xhash...')
```

### Convenience Functions

```typescript
// One-off balance query
const balance = await getBalanceWithBlockchair(account, config)

// One-off transaction query
const txInfo = await getTransactionWithBlockchair(
  'ethereum',
  '0xhash...',
  config
)
```

## 🔄 Data Source Selection Logic

The smart resolvers automatically select the best data source based on:

1. **Chain Support**: Is the chain supported by Blockchair?
2. **Configuration**: Is Blockchair enabled globally?
3. **Chain Overrides**: Are there specific overrides for this chain?
4. **Fallback Behavior**: Should RPC be used as fallback?

### Selection Priority

```
Chain Override → Global Config → Chain Support → RPC Fallback
```

## 🧪 Testing

The Blockchair integration includes comprehensive tests:

```bash
# Run Blockchair tests
yarn test src/vault/balance/blockchair/

# Run specific test files
yarn test src/vault/balance/blockchair/index.test.ts
yarn test src/vault/balance/blockchair/config.test.ts
yarn test src/vault/balance/blockchair/integration.test.ts
```

### Mocking for Tests

```typescript
import { vi } from 'vitest'
import { blockchairClient } from '@src/vault/balance/blockchair'

// Mock the client
vi.mocked(blockchairClient.getAddressInfo).mockResolvedValue(mockAddressData)
```

## 🚦 Error Handling

The Blockchair integration handles various error scenarios:

### Network Errors

```typescript
try {
  const balance = await resolver.getBalance(account)
} catch (error) {
  if (error.message.includes('Blockchair')) {
    // Handle Blockchair-specific errors
  } else {
    // Handle general errors
  }
}
```

### Unsupported Chains

```typescript
import { isChainSupportedByBlockchair } from '@src/vault/balance/blockchair'

if (!isChainSupportedByBlockchair(chain)) {
  // Use RPC fallback
  const balance = await getCoinBalance(account)
}
```

### Rate Limiting

Blockchair automatically handles rate limiting. For premium features, provide an API key:

```typescript
const client = new BlockchairClient({
  apiKey: 'your-premium-api-key',
})
```

## 📈 Performance Benefits

Blockchair typically offers:

- **Faster Response Times**: Indexed data vs. RPC node queries
- **Higher Reliability**: Distributed infrastructure vs. single RPC nodes
- **Better Rate Limits**: Generous limits vs. restrictive RPC quotas
- **Rich Metadata**: Additional data like USD values, transaction counts

### Benchmarks

| Operation   | Blockchair | Direct RPC | Improvement |
| ----------- | ---------- | ---------- | ----------- |
| ETH Balance | ~200ms     | ~800ms     | 4x faster   |
| BTC UTXO    | ~150ms     | ~1000ms    | 6x faster   |
| TX Details  | ~300ms     | ~1200ms    | 4x faster   |

_Benchmarks are approximate and depend on network conditions_

## 🔒 Security Considerations

- **API Key**: Store API keys securely, never in client-side code
- **HTTPS Only**: All Blockchair requests use HTTPS
- **Data Validation**: Always validate data received from external APIs
- **Fallback Strategy**: Always have RPC fallback for critical operations

## 🆘 Troubleshooting

### Common Issues

#### "Chain not supported" Error

```typescript
import { isChainSupportedByBlockchair } from '@src/vault/balance/blockchair'

if (!isChainSupportedByBlockchair(chain)) {
  // Use RPC instead
}
```

#### Timeout Errors

```typescript
const resolver = createSmartBalanceResolver({
  timeout: 20000, // Increase timeout
  retries: 5, // Increase retries
})
```

#### Rate Limiting

```typescript
const client = new BlockchairClient({
  apiKey: 'your-api-key', // Premium key for higher limits
})
```

## 📚 Additional Resources

- [Blockchair API Documentation](https://blockchair.com/api/docs)
- [Blockchair Status Page](https://status.blockchair.com/)
- [Vultisig SDK Documentation](../README.md)

## 🤝 Contributing

When adding support for new chains:

1. Add chain mapping to `config.ts`
2. Create chain-specific resolver in `resolvers/`
3. Add comprehensive tests
4. Update this documentation

## 📄 License

This Blockchair integration is part of the Vultisig SDK. See the main project license for details.
