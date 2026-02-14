# Rujira SDK API Reference

Complete API reference for the Rujira SDK. All methods, interfaces, and types are documented with examples.

## Table of Contents

1. [Client API](#client-api)
2. [Swap Module](#swap-module) 
3. [Discovery Module](#discovery-module)
4. [Orderbook Module](#orderbook-module)
5. [Assets Module](#assets-module)
6. [Easy Routes](#easy-routes)
7. [Types](#types)
8. [Error Codes](#error-codes)
9. [Utilities](#utilities)

## Client API

### RujiraClient

Main client class for interacting with Rujira DEX.

#### Constructor

```typescript
new RujiraClient(options?: RujiraClientOptions)
```

**Parameters:**
- `options` - Optional client configuration

**Example:**
```typescript
const client = new RujiraClient({
  network: 'mainnet',
  signer: vultisigProvider,
  debug: true
});
```

#### connect()

Establishes connection to THORChain network.

```typescript
async connect(): Promise<void>
```

**Throws:** `RujiraError` with `NETWORK_ERROR` code if connection fails.

**Example:**
```typescript
await client.connect();
console.log('Connected to THORChain');
```

#### disconnect()

Closes network connections.

```typescript
disconnect(): void
```

#### isConnected()

Check if client is connected to network.

```typescript
isConnected(): boolean
```

**Returns:** `true` if connected, `false` otherwise.

#### canSign()

Check if client can sign transactions.

```typescript
canSign(): boolean
```

**Returns:** `true` if signer is available, `false` for read-only mode.

#### getAddress()

Get the connected wallet address.

```typescript
async getAddress(): Promise<string>
```

**Returns:** Bech32 address (e.g., "thor1abc...")

**Throws:** `RujiraError` with `MISSING_SIGNER` if no signer provided.

#### getBalance()

Query account balance for specific denom.

```typescript
async getBalance(address: string, denom: string): Promise<Coin>
```

**Parameters:**
- `address` - Bech32 address to query
- `denom` - Asset denomination (e.g., "rune", "btc-btc")

**Returns:** Coin object with amount and denom

**Example:**
```typescript
const balance = await client.getBalance('thor1abc...', 'rune');
console.log(`Balance: ${balance.amount} ${balance.denom}`);
```

#### queryContract()

Query a smart contract.

```typescript
async queryContract<T>(contractAddress: string, query: object): Promise<T>
```

**Parameters:**
- `contractAddress` - Contract address to query
- `query` - Query message object

**Returns:** Query response of specified type

#### executeContract()

Execute a contract method.

```typescript
async executeContract(
  contractAddress: string,
  msg: object,
  funds?: Coin[],
  memo?: string
): Promise<ExecuteResult>
```

**Parameters:**
- `contractAddress` - Contract to execute
- `msg` - Execute message
- `funds` - Coins to send with transaction (default: [])
- `memo` - Transaction memo (optional)

**Returns:** Execution result with transaction hash

#### waitForTransaction()

Wait for transaction confirmation.

```typescript
async waitForTransaction(
  txHash: string, 
  timeoutMs?: number
): Promise<{code: number, height: number, rawLog?: string}>
```

**Parameters:**
- `txHash` - Transaction hash to wait for
- `timeoutMs` - Timeout in milliseconds (default: 60000)

**Returns:** Transaction result when confirmed

## Swap Module

### RujiraSwap

Handles market swap operations.

#### getQuote()

Generate a swap quote.

```typescript
async getQuote(
  params: QuoteParams,
  options?: {skipCache?: boolean, maxStalenessMs?: number}
): Promise<SwapQuote>
```

**Parameters:**
- `params` - Quote parameters
- `options` - Quote options

**Returns:** Detailed swap quote with pricing and fees

**Example:**
```typescript
const quote = await client.swap.getQuote({
  fromAsset: 'rune',
  toAsset: 'btc-btc',
  amount: '100000000', // 1 RUNE
  slippageBps: 100,    // 1%
  destination: 'thor1abc...'
});
```

#### execute()

Execute a pre-generated quote.

```typescript
async execute(quote: SwapQuote, options?: SwapOptions): Promise<SwapResult>
```

**Parameters:**
- `quote` - Quote from `getQuote()`
- `options` - Execution options

**Returns:** Swap result with transaction hash

**Example:**
```typescript
const result = await client.swap.execute(quote, {
  slippageBps: 200, // Override slippage to 2%
  memo: 'My swap'
});
```

#### executeSwap()

One-shot quote and execute.

```typescript
async executeSwap(params: QuoteParams, options?: SwapOptions): Promise<SwapResult>
```

**Parameters:**
- `params` - Swap parameters 
- `options` - Execution options

**Returns:** Swap result

#### buildTransaction()

Build transaction without executing.

```typescript
async buildTransaction(params: QuoteParams): Promise<{
  contractAddress: string,
  msg: FinExecuteMsg,
  funds: Coin[]
}>
```

**Parameters:**
- `params` - Swap parameters

**Returns:** Transaction details for manual signing

#### buildL1Memo()

Generate memo for Layer 1 deposits.

```typescript
async buildL1Memo(params: QuoteParams): Promise<string>
```

**Parameters:**
- `params` - Swap parameters

**Returns:** Memo string for L1 transaction

**Example:**
```typescript
const memo = await client.swap.buildL1Memo({
  fromAsset: 'btc-btc',
  toAsset: 'rune',
  amount: '100000000', // 1 BTC
  destination: 'thor1def...'
});

// Use memo when sending Bitcoin to THORChain vault
```

#### easySwap()

Execute swap using easy routes.

```typescript
async easySwap(request: EasySwapRequest): Promise<SwapResult>
```

**Parameters:**
- `request` - Easy swap request

**Returns:** Swap result

**Example:**
```typescript
const result = await client.swap.easySwap({
  route: 'RUNE_TO_USDC',
  amount: '100000000',
  destination: 'thor1ghi...',
  maxSlippagePercent: 1
});
```

#### batchGetQuotes()

Get quotes for multiple routes in parallel.

```typescript
async batchGetQuotes(
  routes: EasyRouteName[],
  amount: string,
  destination?: string
): Promise<Map<EasyRouteName, SwapQuote | null>>
```

**Parameters:**
- `routes` - Array of route names to quote
- `amount` - Amount for all quotes
- `destination` - Optional destination address

**Returns:** Map of route names to quotes (null if failed)

#### getAllRouteQuotes()

Get quotes for all available easy routes.

```typescript
async getAllRouteQuotes(
  amount: string,
  destination?: string
): Promise<Map<EasyRouteName, SwapQuote | null>>
```

**Parameters:**
- `amount` - Amount for all quotes
- `destination` - Optional destination address

**Returns:** Map of all routes to their quotes

#### clearCache()

Clear the quote cache.

```typescript
clearCache(): void
```

#### getCacheStats()

Get cache statistics.

```typescript
getCacheStats(): {size: number, maxSize: number, ttlMs: number} | null
```

**Returns:** Cache statistics or null if caching disabled

## Discovery Module

### RujiraDiscovery

Handles automatic contract discovery.

#### discoverContracts()

Discover all FIN contracts.

```typescript
async discoverContracts(forceRefresh?: boolean): Promise<DiscoveredContracts>
```

**Parameters:**
- `forceRefresh` - Bypass cache (default: false)

**Returns:** Discovered contract addresses

**Example:**
```typescript
const contracts = await client.discovery.discoverContracts();
console.log('Markets:', Object.keys(contracts.fin));
```

#### findMarket()

Find specific trading pair.

```typescript
async findMarket(baseAsset: string, quoteAsset: string): Promise<Market | null>
```

**Parameters:**
- `baseAsset` - Base asset denom
- `quoteAsset` - Quote asset denom

**Returns:** Market details or null if not found

#### getContractAddress()

Get contract address for trading pair.

```typescript
async getContractAddress(baseAsset: string, quoteAsset: string): Promise<string | null>
```

**Parameters:**
- `baseAsset` - Base asset denom
- `quoteAsset` - Quote asset denom

**Returns:** Contract address or null if not found

#### listMarkets()

List all available markets.

```typescript
async listMarkets(): Promise<Market[]>
```

**Returns:** Array of market details

#### clearCache()

Clear discovery cache.

```typescript
clearCache(): void
```

#### getCacheStatus()

Get cache status.

```typescript
getCacheStatus(): {cached: boolean, age?: number, valid: boolean, ttl: number}
```

**Returns:** Cache status information

## Orderbook Module

### RujiraOrderbook

Provides orderbook data access.

#### getBook()

Get orderbook for trading pair.

```typescript
async getBook(baseAsset: string, quoteAsset: string): Promise<OrderBook>
```

**Parameters:**
- `baseAsset` - Base asset denom
- `quoteAsset` - Quote asset denom

**Returns:** Complete orderbook data

**Example:**
```typescript
const book = await client.orderbook.getBook('btc-btc', 'rune');
console.log('Best bid:', book.bids[0]);
console.log('Best ask:', book.asks[0]);
```

## Assets Module

### RujiraAssets

Asset metadata and balance management.

#### getAssetInfo()

Get asset metadata.

```typescript
async getAssetInfo(denom: string): Promise<{
  denom: string,
  ticker: string,
  decimals: number,
  chainDecimals: number
}>
```

**Parameters:**
- `denom` - Asset denomination

**Returns:** Asset metadata

#### getBalance()

Get balance with proper decimal handling.

```typescript
async getBalance(address: string, denom: string): Promise<{
  amount: string,
  decimals: number,
  formatted: string
}>
```

**Parameters:**
- `address` - Account address
- `denom` - Asset denomination

**Returns:** Balance information

## Easy Routes

### Constants

#### EASY_ROUTES

Pre-configured trading routes.

```typescript
const EASY_ROUTES: {
  RUNE_TO_USDC: EasyRoute,
  USDC_TO_RUNE: EasyRoute,
  RUNE_TO_BTC: EasyRoute,
  BTC_TO_RUNE: EasyRoute,
  // ... more routes
}
```

#### ASSETS

Common asset shortcuts.

```typescript
const ASSETS: {
  RUNE: 'rune',
  BTC: 'btc-btc',
  ETH: 'eth-eth',
  USDC: 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  // ... more assets
}
```

### Functions

#### listEasyRoutes()

List all available routes.

```typescript
function listEasyRoutes(): Array<{
  id: EasyRouteName,
  name: string,
  from: string,
  to: string,
  description: string,
  liquidity: string,
  typicalTime: string
}>
```

#### findRoute()

Find route for asset pair.

```typescript
function findRoute(from: string, to: string): EasyRoute | undefined
```

#### routesFrom()

Get all routes from an asset.

```typescript
function routesFrom(asset: string): EasyRoute[]
```

#### routesTo()

Get all routes to an asset.

```typescript
function routesTo(asset: string): EasyRoute[]
```

## Types

### QuoteParams

Parameters for requesting a swap quote.

```typescript
interface QuoteParams {
  fromAsset: string;      // Source asset denom
  toAsset: string;        // Destination asset denom
  amount: string;         // Amount in base units
  slippageBps?: number;   // Slippage tolerance (default: 100)
  destination?: string;   // Destination address
  affiliate?: string;     // Affiliate address
  affiliateBps?: number;  // Affiliate fee
}
```

### SwapQuote

Detailed swap quote response.

```typescript
interface SwapQuote {
  params: QuoteParams;
  expectedOutput: string;    // Expected output amount
  minimumOutput: string;     // Minimum after slippage
  rate: string;             // Exchange rate
  priceImpact: string;      // Price impact percentage
  fees: {
    network: string;
    protocol: string;
    affiliate: string;
    total: string;
  };
  contractAddress: string;  // FIN contract address
  expiresAt: number;       // Quote expiry timestamp
  quoteId: string;         // Unique quote identifier
  cachedAt?: number;       // Cache timestamp
  warning?: string;        // Warning message
}
```

### SwapOptions

Options for swap execution.

```typescript
interface SwapOptions {
  slippageBps?: number;        // Override slippage
  gasLimit?: number;           // Custom gas limit
  gasPrice?: string;           // Custom gas price
  memo?: string;               // Transaction memo
  skipBalanceValidation?: boolean; // Internal use
}
```

### SwapResult

Result of swap execution.

```typescript
interface SwapResult {
  txHash: string;              // Transaction hash
  status: 'pending' | 'success' | 'failed';
  fromAmount: string;          // Input amount
  toAmount?: string;           // Output amount (after confirmation)
  fee: string;                 // Fees paid
  blockHeight?: number;        // Block height (after confirmation)
  timestamp: number;           // Execution timestamp
}
```

### EasySwapRequest

Simplified swap request for easy routes.

```typescript
interface EasySwapRequest {
  route?: EasyRouteName;       // Route name (e.g., 'RUNE_TO_USDC')
  from?: string;               // Source asset (alternative to route)
  to?: string;                 // Destination asset (alternative to route)
  amount: string;              // Amount in base units
  destination: string;         // Destination address
  maxSlippagePercent?: number; // Max slippage percentage
}
```

### Market

Trading pair information.

```typescript
interface Market {
  address: string;             // Contract address
  baseAsset: string;           // Base asset denom
  quoteAsset: string;          // Quote asset denom
  baseDenom: string;           // Base asset denom (same as baseAsset)
  quoteDenom: string;          // Quote asset denom (same as quoteAsset)
  tick: string;                // Tick size
  takerFee: string;            // Taker fee rate
  makerFee: string;            // Maker fee rate
  active: boolean;             // Market active status
}
```

### OrderBook

Orderbook data structure.

```typescript
interface OrderBook {
  pair: TradingPair;           // Trading pair info
  bids: OrderBookEntry[];      // Buy orders (high to low)
  asks: OrderBookEntry[];      // Sell orders (low to high)
  spread: string;              // Bid-ask spread percentage
  lastPrice: string;           // Last traded price
  timestamp: number;           // Data timestamp
}
```

### OrderBookEntry

Individual orderbook entry.

```typescript
interface OrderBookEntry {
  price: string;               // Price level
  amount: string;              // Total amount at price
  total: string;               // Total value (price × amount)
}
```

## Error Codes

### RujiraErrorCode

Enumeration of all possible error codes.

```typescript
enum RujiraErrorCode {
  // Network errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  RPC_ERROR = 'RPC_ERROR',
  TIMEOUT = 'TIMEOUT',
  NOT_CONNECTED = 'NOT_CONNECTED',
  
  // Validation errors
  INVALID_ASSET = 'INVALID_ASSET',
  INVALID_AMOUNT = 'INVALID_AMOUNT',
  INVALID_ADDRESS = 'INVALID_ADDRESS',
  INVALID_PAIR = 'INVALID_PAIR',
  INVALID_SLIPPAGE = 'INVALID_SLIPPAGE',
  
  // Balance errors
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  INSUFFICIENT_GAS = 'INSUFFICIENT_GAS',
  
  // Swap errors
  NO_ROUTE = 'NO_ROUTE',
  SLIPPAGE_EXCEEDED = 'SLIPPAGE_EXCEEDED',
  QUOTE_EXPIRED = 'QUOTE_EXPIRED',
  PRICE_IMPACT_TOO_HIGH = 'PRICE_IMPACT_TOO_HIGH',
  
  // Transaction errors
  SIGNING_FAILED = 'SIGNING_FAILED',
  BROADCAST_FAILED = 'BROADCAST_FAILED',
  TX_FAILED = 'TX_FAILED',
  TX_NOT_FOUND = 'TX_NOT_FOUND',
  
  // Contract errors
  CONTRACT_NOT_FOUND = 'CONTRACT_NOT_FOUND',
  CONTRACT_ERROR = 'CONTRACT_ERROR',
  
  // Configuration errors
  INVALID_CONFIG = 'INVALID_CONFIG',
  MISSING_SIGNER = 'MISSING_SIGNER'
}
```

### RujiraError

Main error class with rich context.

```typescript
class RujiraError extends Error {
  readonly code: RujiraErrorCode;
  readonly details?: unknown;
  readonly retryable: boolean;
  
  constructor(
    code: RujiraErrorCode,
    message: string,
    details?: unknown,
    retryable?: boolean
  );
  
  toUserMessage(): string;      // User-friendly message
  toJSON(): Record<string, unknown>; // Serializable format
}
```

**Example:**
```typescript
try {
  await client.swap.executeSwap(params);
} catch (error) {
  if (error instanceof RujiraError) {
    switch (error.code) {
      case RujiraErrorCode.INSUFFICIENT_BALANCE:
        console.error('Not enough funds:', error.toUserMessage());
        break;
      case RujiraErrorCode.QUOTE_EXPIRED:
        console.log('Quote expired, retrying...');
        // Retry logic
        break;
      default:
        console.error('Swap failed:', error.message);
    }
  }
}
```

## Utilities

### Format Utilities

#### calculateMinReturn()

Calculate minimum return with slippage.

```typescript
function calculateMinReturn(expectedOutput: string, slippageBps: number): string
```

#### generateQuoteId()

Generate unique quote identifier.

```typescript
function generateQuoteId(): string
```

### Asset Utilities

#### getAssetMetadata()

Get asset metadata with fallbacks.

```typescript
function getAssetMetadata(denom: string): {
  decimals: number,
  chainDecimals: number,
  ticker: string
}
```

#### denomToTicker()

Convert denom to display ticker.

```typescript
function denomToTicker(denom: string): string
```

**Example:**
```typescript
denomToTicker('btc-btc');        // 'BTC'
denomToTicker('eth-usdc-0x...');  // 'USDC'
denomToTicker('rune');           // 'RUNE'
```

### Cache Utilities

#### QuoteCache

Generic caching implementation for quotes.

```typescript
class QuoteCache<T> {
  constructor(options?: QuoteCacheOptions);
  
  get(fromAsset: string, toAsset: string, amount: string): T | null;
  set(fromAsset: string, toAsset: string, amount: string, value: T): void;
  clear(): void;
  stats(): {size: number, maxSize: number, ttlMs: number};
}
```

### Network Utilities

#### getNetworkConfig()

Get configuration for a network.

```typescript
function getNetworkConfig(network: NetworkType): RujiraConfig
```

#### isRetryableError()

Check if an error is retryable.

```typescript
function isRetryableError(error: unknown): boolean
```

#### wrapError()

Convert errors to RujiraError.

```typescript
function wrapError(error: unknown, defaultCode?: RujiraErrorCode): RujiraError
```

---

This API reference provides complete coverage of the Rujira SDK. All methods include parameter validation and comprehensive error handling. For usage examples, see the [Examples documentation](./EXAMPLES.md).