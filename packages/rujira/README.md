# @vultisig/rujira

TypeScript SDK for integrating Vultisig with [Rujira DEX](https://rujira.network) - the THORChain App Layer orderbook exchange.

> ⚠️ **Alpha** - API may change. Not yet published to npm.

## Easy Swap Routes

**For agents and humans — just pick a route and swap.**

| Route | From → To | Time |
|-------|-----------|------|
| `RUNE_TO_USDC` | RUNE → USDC | ~30s |
| `USDC_TO_RUNE` | USDC → RUNE | ~30s |
| `RUNE_TO_BTC` | RUNE → Bitcoin | ~10-60min |
| `BTC_TO_RUNE` | Bitcoin → RUNE | ~10-60min |
| `RUNE_TO_ETH` | RUNE → Ethereum | ~30s |
| `ETH_TO_RUNE` | Ethereum → RUNE | ~30s |
| `BTC_TO_USDC` | Bitcoin → USDC | ~10-60min |
| `USDC_TO_BTC` | USDC → Bitcoin | ~10-60min |
| `ETH_TO_USDC` | ETH → USDC | ~30s |
| `USDC_TO_ETH` | USDC → ETH | ~30s |
| `BTC_TO_ETH` | Bitcoin → ETH | ~10-60min |
| `ETH_TO_BTC` | ETH → Bitcoin | ~10-60min |

```typescript
import { EASY_ROUTES, RujiraClient } from '@vultisig/rujira';

const client = new RujiraClient({ network: 'mainnet' });
await client.connect();

// Pick a route, get a quote
const route = EASY_ROUTES.RUNE_TO_USDC;
const quote = await client.swap.getQuote({
  fromAsset: route.from,
  toAsset: route.to,
  amount: '10000000000' // 100 RUNE
});

console.log(`100 RUNE → ${quote.expectedOutput} USDC`);
```

### Helper Functions

```typescript
import { listEasyRoutes, findRoute, routesFrom, ASSETS } from '@vultisig/rujira';

// List all routes (great for agents)
const routes = listEasyRoutes();

// Find a specific route
const route = findRoute('THOR.RUNE', 'ETH.ETH');

// Get all routes from an asset
const fromBtc = routesFrom(ASSETS.BTC);

// Use asset shortcuts to avoid typos
console.log(ASSETS.USDC); // 'ETH.USDC-0XA0B86991...'
```

---

## Asset Notation

Rujira uses two different asset formats depending on context:

| Type | SDK Format | On-Chain Denom (FIN) |
|------|------------|----------------------|
| Native L1 | `BTC.BTC` | `btc-btc` |
| Native L1 | `ETH.ETH` | `eth-eth` |
| THORChain Native | `THOR.RUNE` | `rune` |
| Secured (ERC20) | `ETH.USDC-0xA0B8...` | `eth-usdc-0xa0b8...` |
| Secured (ERC20) | `ETH.USDT-0xDAC1...` | `eth-usdt-0xdac1...` |

**Key differences:**
- **SDK format**: Uses `.` as chain separator, uppercase, matches THORChain asset notation
- **On-chain denom**: Uses `-` as separator, lowercase, what FIN contracts actually expect

**The SDK handles conversion automatically** — you always use the SDK format (`BTC.BTC`, `ETH.USDC-0x...`) and the SDK converts to on-chain denoms internally when querying FIN contracts.

```typescript
// You write (SDK format):
const quote = await client.swap.getQuote({
  fromAsset: 'BTC.BTC',
  toAsset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
  amount: '10000000'
});

// SDK converts to on-chain format internally:
// btc-btc → eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48
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

### Read-Only (Quotes & Discovery)

```typescript
import { RujiraClient } from '@vultisig/rujira';

const client = new RujiraClient({ network: 'mainnet' });
await client.connect();

// Discover all available markets
const markets = await client.discovery.listMarkets();
console.log(`Found ${markets.length} trading pairs`);

// Get a swap quote
const quote = await client.swap.getQuote({
  fromAsset: 'BTC.BTC',
  toAsset: 'THOR.RUNE',
  amount: '10000000', // 0.1 BTC (8 decimals)
  slippageBps: 100    // 1% max slippage
});

console.log({
  expectedOutput: quote.expectedOutput,
  minimumOutput: quote.minimumOutput,
  priceImpact: quote.priceImpact,
  fees: quote.fees
});
```

### With Vultisig Signer (Execute Trades)

```typescript
import { RujiraClient } from '@vultisig/rujira';
import { VultisigRujiraProvider } from '@vultisig/rujira/signer';

// Create signer from Vultisig vault
const signer = new VultisigRujiraProvider(vault, {
  chainId: 'thorchain-1',
  addressPrefix: 'thor'
});

const client = new RujiraClient({ 
  network: 'mainnet',
  signer 
});
await client.connect();

// Execute a swap
const result = await client.swap.executeSwap({
  fromAsset: 'BTC.BTC',
  toAsset: 'THOR.RUNE',
  amount: '10000000'
});

console.log(`TX Hash: ${result.txHash}`);

// Wait for confirmation
const confirmed = await client.waitForTransaction(result.txHash);
```

### Cross-Chain (L1 Deposits)

For swapping from external chains like Bitcoin or Ethereum:

```typescript
// Build memo for L1 deposit
const memo = await client.swap.buildL1Memo({
  fromAsset: 'BTC.BTC',
  toAsset: 'THOR.RUNE',
  amount: '10000000',
  destination: 'thor1abc...'
});

// Returns: "x:thor1fin...:eyJzd2FwIjp7...}}"
// Send BTC to THORChain vault with this memo
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
// { fin: { "BTC.BTC/THOR.RUNE": "thor1...", ... } }

// Find a specific market
const market = await client.discovery.findMarket('BTC.BTC', 'THOR.RUNE');
console.log(market.address);

// List all markets with details
const markets = await client.discovery.listMarkets();
```

### Swap Module

Quote and execute market swaps.

```typescript
// Get a quote (read-only, no signer needed)
const quote = await client.swap.getQuote({
  fromAsset: string,    // e.g., "BTC.BTC"
  toAsset: string,      // e.g., "THOR.RUNE"
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
const book = await client.orderbook.getBook('BTC.BTC', 'THOR.RUNE');
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

| Pair (SDK Format) | On-Chain Denom Pair | Type |
|-------------------|---------------------|------|
| `BTC.BTC` / `ETH.USDC-0x...` | `btc-btc` / `eth-usdc-0x...` | Major |
| `ETH.ETH` / `ETH.USDC-0x...` | `eth-eth` / `eth-usdc-0x...` | Major |
| `ETH.ETH` / `BTC.BTC` | `eth-eth` / `btc-btc` | Major |
| `THOR.RUNE` / `ETH.USDC-0x...` | `rune` / `eth-usdc-0x...` | Native |
| `THOR.TCY` / `BTC.BTC` | `tcy` / `btc-btc` | Native |
| `AVAX.AVAX` / `ETH.USDC-0x...` | `avax-avax` / `eth-usdc-0x...` | Alt |
| `DOGE.DOGE` / `ETH.USDC-0x...` | `doge-doge` / `eth-usdc-0x...` | Alt |
| ... and 20+ more | | |

> **Note:** Secured assets (like USDC, USDT) use the format `CHAIN.SYMBOL-CONTRACT_ADDRESS` in SDK, converted to `chain-symbol-contract_address` on-chain.

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
