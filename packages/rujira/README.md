# @vultisig/rujira

TypeScript SDK for integrating Vultisig with [Rujira DEX](https://rujira.network) - the THORChain App Layer orderbook exchange.

> ⚠️ **Alpha** - API may change. Not yet published to npm.

## Asset Notation

This SDK uses **on-chain denominations** throughout for consistency and reliability:

| Type | Format | Examples |
|------|--------|----------|
| THORChain Native | `{symbol}` | `rune`, `tcy`, `ruji` |
| Native L1 Assets | `{chain}-{symbol}` | `btc-btc`, `eth-eth`, `avax-avax` |
| Secured Tokens | `{chain}-{symbol}-{contract}` | `eth-usdc-0xa0b86991...` |

**Benefits of on-chain denoms:**
- ✅ **No conversion errors**: What you write is exactly what goes on-chain
- ✅ **Consistent ecosystem**: Works with all THORChain tools and APIs
- ✅ **Simplified debugging**: Transaction logs match SDK inputs
- ✅ **Future-proof**: New assets follow predictable naming patterns

**Quick reference**: Use `ASSETS` constants to avoid typos:
```typescript
import { ASSETS } from '@vultisig/rujira';

console.log(ASSETS.BTC);   // 'btc-btc'
console.log(ASSETS.USDC);  // 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
```

---

## Easy Swap Routes

**For agents and humans — just pick a route and swap.**

| Route | From → To | Time |
|-------|-----------|------|
| `RUNE_TO_USDC` | rune → usdc | ~30s |
| `USDC_TO_RUNE` | usdc → rune | ~30s |
| `RUNE_TO_BTC` | rune → btc | ~10-60min |
| `BTC_TO_RUNE` | btc → rune | ~10-60min |
| `RUNE_TO_ETH` | rune → eth | ~30s |
| `ETH_TO_RUNE` | eth → rune | ~30s |
| `BTC_TO_USDC` | btc → usdc | ~10-60min |
| `USDC_TO_BTC` | usdc → btc | ~10-60min |
| `ETH_TO_USDC` | eth → usdc | ~30s |
| `USDC_TO_ETH` | usdc → eth | ~30s |
| `BTC_TO_ETH` | btc → eth | ~10-60min |
| `ETH_TO_BTC` | eth → btc | ~10-60min |

```typescript
import { EASY_ROUTES, ASSETS, RujiraClient } from '@vultisig/rujira';

const client = new RujiraClient({ network: 'mainnet' });
await client.connect();

// Pick a route, get a quote
const route = EASY_ROUTES.RUNE_TO_USDC;
const quote = await client.swap.getQuote({
  fromAsset: route.from,  // 'rune'
  toAsset: route.to,      // 'eth-usdc-0xa0b86991...'
  amount: '10000000000'   // 100 RUNE (8 decimals)
});

console.log(`100 RUNE → ${quote.expectedOutput} USDC`);
```

### Asset Shortcuts

```typescript
import { ASSETS, listEasyRoutes, findRoute, routesFrom } from '@vultisig/rujira';

// Use shortcuts to avoid typos
console.log(ASSETS.BTC);   // 'btc-btc'
console.log(ASSETS.USDC);  // 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
console.log(ASSETS.RUNE);  // 'rune'

// List all routes (great for agents)
const routes = listEasyRoutes();

// Find a specific route
const route = findRoute('rune', 'btc-btc');

// Get all routes from an asset
const fromBtc = routesFrom(ASSETS.BTC);
```

---

## Features

- 🎯 **Easy Routes** - Pre-configured swaps for common pairs
- 🔍 **Auto-discovery** - Finds all FIN contracts automatically
- 💱 **Swap module** - Quote and execute market swaps
- 📊 **Orderbook access** - Query live order books
- 🔐 **Vultisig integration** - MPC signing via VultisigRujiraProvider
- 🌐 **Cross-chain** - Build L1 deposit memos for BTC/ETH/etc

## Installation

```bash
npm install @vultisig/rujira
# or
yarn add @vultisig/rujira
```

## Quick Start

### Read-Only Client (Quotes & Market Data)

Perfect for price feeds, market analysis, or planning trades:

```typescript
import { RujiraClient, ASSETS } from '@vultisig/rujira';

// Initialize without signer for read-only operations
const client = new RujiraClient({ 
  network: 'mainnet',
  debug: true  // Enable logging during development
});
await client.connect();

// Discover all available trading pairs
const markets = await client.discovery.listMarkets();
console.log(`Found ${markets.length} active markets`);

// Get real-time swap quote
const quote = await client.swap.getQuote({
  fromAsset: ASSETS.BTC,    // 'btc-btc'
  toAsset: ASSETS.RUNE,     // 'rune'
  amount: '10000000',       // 0.1 BTC (8 decimals)
  slippageBps: 100          // 1% max slippage
});

console.log('Quote Details:');
console.log(`Input: 0.1 BTC`);
console.log(`Expected output: ${quote.expectedOutput} RUNE`);
console.log(`Minimum output: ${quote.minimumOutput} RUNE`);
console.log(`Price impact: ${quote.priceImpact}%`);
console.log(`Total fees: ${quote.fees.total} RUNE`);
console.log(`Quote expires: ${new Date(quote.expiresAt).toLocaleString()}`);

// Check orderbook depth
const orderbook = await client.orderbook.getBook('btc-btc', 'rune');
console.log(`Spread: ${orderbook.spread}%`);
console.log(`Best bid: ${orderbook.bids[0]?.price}`);
console.log(`Best ask: ${orderbook.asks[0]?.price}`);
```

### Full Client with Vultisig Signer (Execute Trades)

For live trading with your Vultisig vault:

```typescript
import { RujiraClient, ASSETS } from '@vultisig/rujira';
import { VultisigRujiraProvider } from '@vultisig/rujira/signer';

// Create Vultisig signer from your vault
const signer = new VultisigRujiraProvider(vault, {
  chainId: 'thorchain-1',
  addressPrefix: 'thor'
});

const client = new RujiraClient({ 
  network: 'mainnet',
  signer,
  debug: false  // Disable debug logging in production
});
await client.connect();

console.log(`Connected as: ${await client.getAddress()}`);

// Option 1: One-shot swap execution
const result = await client.swap.executeSwap({
  fromAsset: ASSETS.BTC,     // 'btc-btc'
  toAsset: ASSETS.RUNE,      // 'rune'
  amount: '10000000',        // 0.1 BTC
  destination: 'thor1...',   // Your address (optional, defaults to signer)
  slippageBps: 100          // 1% max slippage
});

console.log(`Swap submitted: ${result.txHash}`);
console.log(`Status: ${result.status}`);

// Option 2: Quote first, then execute (for price validation)
const quote = await client.swap.getQuote({
  fromAsset: ASSETS.BTC,
  toAsset: ASSETS.RUNE,
  amount: '10000000'
});

// Check if quote is acceptable
if (parseFloat(quote.priceImpact) > 2.0) {
  console.log(`High price impact: ${quote.priceImpact}%, consider reducing amount`);
} else {
  const result = await client.swap.execute(quote);
  console.log(`Trade executed: ${result.txHash}`);
}

// Monitor transaction confirmation
try {
  const confirmed = await client.waitForTransaction(result.txHash, 60000);
  if (confirmed.code === 0) {
    console.log(`✅ Transaction confirmed in block ${confirmed.height}`);
  } else {
    console.log(`❌ Transaction failed: ${confirmed.rawLog}`);
  }
} catch (error) {
  console.log(`⏰ Transaction pending (check explorer for status)`);
}
```

### Cross-Chain Deposits (L1 → THORChain)

For swapping assets from external blockchains (Bitcoin, Ethereum, etc.) into THORChain:

```typescript
// Generate deposit memo for Bitcoin → RUNE swap
const memo = await client.swap.buildL1Memo({
  fromAsset: ASSETS.BTC,     // 'btc-btc'
  toAsset: ASSETS.RUNE,      // 'rune'  
  amount: '100000000',       // 1 BTC (8 decimals)
  destination: 'thor1...',   // Where to send the swapped RUNE
  slippageBps: 100          // 1% max slippage
});

console.log('Deposit memo:', memo);
// Output: "x:thor1fin...:eyJzd2FwIjp7...}"

/*
Next steps for Bitcoin deposit:
1. Send 1 BTC to THORChain's Bitcoin vault address
2. Include the generated memo in the transaction
3. THORChain will automatically execute the swap when BTC is received
4. RUNE will be delivered to your specified destination address

Vault addresses can be found at:
- Mainnet: https://thornode.ninerealms.com/thorchain/inbound_addresses  
- Stagenet: https://stagenet-thornode.ninerealms.com/thorchain/inbound_addresses
*/

// For Ethereum-based assets (ETH, USDC, etc.)
const ethMemo = await client.swap.buildL1Memo({
  fromAsset: ASSETS.ETH,     // 'eth-eth'
  toAsset: ASSETS.USDC,      // 'eth-usdc-0xa0b86991...'
  amount: '2000000000000000000', // 2 ETH (18 decimals)
  destination: 'thor1...'
});

// Send ETH to THORChain's Ethereum vault with this memo
```

## API Reference

### RujiraClient

Main client for interacting with Rujira DEX.

```typescript
const client = new RujiraClient({
  network: 'mainnet' | 'stagenet',  // Default: 'mainnet'
  signer?: RujiraSigner,            // Optional, for transactions
  rpcEndpoint?: string,             // Custom RPC override
  debug?: boolean                   // Enable logging
});
```

### Discovery Module

Auto-discovers FIN contracts from the chain.

```typescript
// Discover all markets (cached for 5 min)
const contracts = await client.discovery.discoverContracts();
// { fin: { "btc-btc/rune": "thor1...", ... } }

// Find a specific market
const market = await client.discovery.findMarket('btc-btc', 'rune');
console.log(market.address);

// List all markets with details
const markets = await client.discovery.listMarkets();
```

### Swap Module

Quote and execute market swaps.

```typescript
// Get a quote (read-only, no signer needed)
const quote = await client.swap.getQuote({
  fromAsset: string,    // e.g., 'btc-btc'
  toAsset: string,      // e.g., 'rune'
  amount: string,       // In base units (satoshis, wei, etc.)
  slippageBps?: number, // Default: 100 (1%)
  destination?: string  // Recipient address (optional)
});

// Execute a quote (requires signer)
const result = await client.swap.execute(quote);

// One-shot: quote + execute
const result = await client.swap.executeSwap(params);

// Build transaction without executing
const tx = await client.swap.buildTransaction(params);
```

### Orderbook Module

Query order books directly.

```typescript
const book = await client.orderbook.getBook('btc-btc', 'rune');
console.log(book.bids, book.asks);
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        RujiraClient                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Swap       │  │  Orderbook   │  │     Discovery        │  │
│  │   Module     │  │   Module     │  │      Module          │  │
│  └──────┬───────┘  └──────────────┘  └──────────┬───────────┘  │
│         │                                        │              │
│         ▼                                        ▼              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Contract Discovery                          │   │
│  │   Primary: GraphQL API (api.rujira.network)             │   │
│  │   Fallback: Chain Query (thornode.ninerealms.com)       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                             │                                   │
│                             ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              VultisigRujiraProvider                      │   │
│  │              (CosmJS-compatible signer)                  │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Supported Markets

The SDK auto-discovers all FIN markets. As of Jan 2025:

| Pair | Type |
|------|------|
| `btc-btc` / `eth-usdc-0x...` | Major |
| `eth-eth` / `eth-usdc-0x...` | Major |
| `eth-eth` / `btc-btc` | Major |
| `rune` / `eth-usdc-0x...` | Native |
| `tcy` / `btc-btc` | Native |
| `avax-avax` / `eth-usdc-0x...` | Alt |
| `doge-doge` / `eth-usdc-0x...` | Alt |
| ... and 20+ more | |

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Lint
npm run lint
```

## License

MIT

## Links

- [Rujira Docs](https://docs.rujira.network)
- [Vultisig](https://vultisig.com)
- [THORChain](https://thorchain.org)
