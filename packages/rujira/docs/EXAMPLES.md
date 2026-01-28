# Rujira SDK Examples

This document provides comprehensive examples for using the Rujira SDK in various scenarios. Examples are organized by use case and complexity level.

## Table of Contents

1. [Basic Setup](#basic-setup)
2. [Read-Only Operations](#read-only-operations)
3. [Simple Swaps](#simple-swaps)
4. [Advanced Swaps](#advanced-swaps)
5. [Batch Operations](#batch-operations)
6. [Cross-Chain Deposits](#cross-chain-deposits)
7. [Error Handling](#error-handling)
8. [AI Agent Patterns](#ai-agent-patterns)
9. [Production Patterns](#production-patterns)

## Basic Setup

### Installation and Imports

```typescript
import {
  RujiraClient,
  VultisigRujiraProvider,
  EASY_ROUTES,
  ASSETS,
  RujiraError,
  RujiraErrorCode
} from '@vultisig/rujira';
```

### Read-Only Client (Quotes and Data)

```typescript
// Initialize client without signer for read-only operations
const client = new RujiraClient({
  network: 'mainnet',  // or 'stagenet' for testing
  debug: true          // Enable logging for development
});

await client.connect();
console.log('Connected to THORChain');
```

### Full Client with Signer (For Transactions)

```typescript
// Import your Vultisig vault
import { VultisigVault } from '@vultisig/vault';

// Create Vultisig signer
const vault = new VultisigVault(/* vault config */);
const signer = new VultisigRujiraProvider(vault, {
  chainId: 'thorchain-1',
  addressPrefix: 'thor'
});

// Initialize client with signer
const client = new RujiraClient({
  network: 'mainnet',
  signer,
  debug: false  // Disable debug in production
});

await client.connect();
```

## Read-Only Operations

### Market Discovery

```typescript
// Discover all available trading pairs
const contracts = await client.discovery.discoverContracts();
console.log('Available markets:', Object.keys(contracts.fin));
// Output: ["rune/eth-usdc-0xa0b86991...", "btc-btc/rune", ...]

// Get detailed market information
const markets = await client.discovery.listMarkets();
markets.forEach(market => {
  console.log(`${market.baseAsset}/${market.quoteAsset}: ${market.address}`);
});

// Find specific market
const btcRuneMarket = await client.discovery.findMarket('btc-btc', 'rune');
if (btcRuneMarket) {
  console.log(`BTC/RUNE trades at: ${btcRuneMarket.address}`);
}
```

### Getting Quotes

```typescript
// Get a swap quote
const quote = await client.swap.getQuote({
  fromAsset: ASSETS.BTC,     // 'btc-btc'
  toAsset: ASSETS.RUNE,      // 'rune'
  amount: '10000000',        // 0.1 BTC (8 decimals)
  slippageBps: 100          // 1% max slippage
});

console.log(`Quote for 0.1 BTC → RUNE:`);
console.log(`Expected output: ${quote.expectedOutput} RUNE`);
console.log(`Minimum output: ${quote.minimumOutput} RUNE`);
console.log(`Price impact: ${quote.priceImpact}%`);
console.log(`Total fees: ${quote.fees.total} RUNE`);
console.log(`Quote expires at: ${new Date(quote.expiresAt)}`);
```

### Balance Checking

```typescript
// Check user's balance
const address = await client.getAddress();
const runeBalance = await client.getBalance(address, 'rune');
console.log(`RUNE balance: ${runeBalance.amount} (${runeBalance.denom})`);

// Check balance in human-readable format
const btcBalance = await client.getBalance(address, 'btc-btc');
const btcAmount = parseFloat(btcBalance.amount) / 1e8; // Convert from base units
console.log(`BTC balance: ${btcAmount} BTC`);
```

### Orderbook Data

```typescript
// Get orderbook for a trading pair
const orderbook = await client.orderbook.getBook('btc-btc', 'rune');

console.log('Top 5 Bids:');
orderbook.bids.slice(0, 5).forEach(bid => {
  console.log(`Price: ${bid.price}, Amount: ${bid.amount}`);
});

console.log('Top 5 Asks:');
orderbook.asks.slice(0, 5).forEach(ask => {
  console.log(`Price: ${ask.price}, Amount: ${ask.amount}`);
});

console.log(`Spread: ${orderbook.spread}%`);
```

## Simple Swaps

### Easy Route Swaps

```typescript
// List all available routes
const routes = listEasyRoutes();
console.log('Available easy routes:');
routes.forEach(route => {
  console.log(`${route.id}: ${route.name} (${route.typicalTime})`);
});

// Execute a simple swap using easy routes
const result = await client.swap.easySwap({
  route: 'RUNE_TO_USDC',
  amount: '100000000',      // 1 RUNE (8 decimals)
  destination: 'thor1abc...',  // Your address
  maxSlippagePercent: 1     // 1% max slippage
});

console.log(`Swap submitted: ${result.txHash}`);
console.log('Status:', result.status);

// Wait for confirmation
try {
  const confirmed = await client.waitForTransaction(result.txHash);
  console.log(`Transaction confirmed in block ${confirmed.height}`);
} catch (error) {
  console.error('Transaction failed:', error.message);
}
```

### Custom Asset Swaps

```typescript
// Swap custom assets (not in easy routes)
const customQuote = await client.swap.getQuote({
  fromAsset: 'eth-eth',
  toAsset: 'doge-doge',
  amount: '1000000000000000000',  // 1 ETH (18 decimals in base, 8 in contract)
  destination: 'thor1def...'
});

// Execute the quote
const customResult = await client.swap.execute(customQuote);
console.log(`Custom swap: ${customResult.txHash}`);
```

## Advanced Swaps

### Swap with Custom Slippage

```typescript
// Get quote with default slippage
const quote = await client.swap.getQuote({
  fromAsset: ASSETS.BTC,
  toAsset: ASSETS.ETH,
  amount: '50000000'  // 0.5 BTC
});

// Execute with different slippage tolerance
const result = await client.swap.execute(quote, {
  slippageBps: 200,  // Override to 2% slippage
  memo: 'BTC→ETH arbitrage'
});
```

### Quote Validation and Freshness

```typescript
// Get fresh quote (skip cache)
const freshQuote = await client.swap.getQuote({
  fromAsset: ASSETS.RUNE,
  toAsset: ASSETS.USDC,
  amount: '1000000000'
}, { skipCache: true });

// Check quote staleness
const now = Date.now();
const age = freshQuote.cachedAt ? now - freshQuote.cachedAt : 0;
console.log(`Quote age: ${age}ms`);

if (age > 10000) {  // More than 10 seconds
  console.warn('Quote may be stale for volatile markets');
}

// Get quote with staleness tolerance
const tolerantQuote = await client.swap.getQuote({
  fromAsset: ASSETS.ETH,
  toAsset: ASSETS.USDC,
  amount: '2000000000000000000'  // 2 ETH
}, { maxStalenessMs: 5000 });  // Accept up to 5 seconds old
```

### Pre-built Transaction (Manual Signing)

```typescript
// Build transaction without executing
const txDetails = await client.swap.buildTransaction({
  fromAsset: ASSETS.RUNE,
  toAsset: ASSETS.BTC,
  amount: '500000000',  // 5 RUNE
  destination: 'thor1ghi...'
});

console.log('Contract:', txDetails.contractAddress);
console.log('Message:', JSON.stringify(txDetails.msg, null, 2));
console.log('Funds:', txDetails.funds);

// You can now sign and broadcast manually if needed
```

## Batch Operations

### Compare Multiple Routes

```typescript
// Get quotes for multiple routes with the same input
const routes: EasyRouteName[] = ['RUNE_TO_USDC', 'RUNE_TO_BTC', 'RUNE_TO_ETH'];
const quotes = await client.swap.batchGetQuotes(routes, '100000000');

// Find best route by output amount
let bestRoute: EasyRouteName | null = null;
let bestOutput = 0n;

for (const [route, quote] of quotes) {
  if (quote) {
    const output = BigInt(quote.expectedOutput);
    console.log(`${route}: ${quote.expectedOutput} output`);
    
    if (output > bestOutput) {
      bestOutput = output;
      bestRoute = route;
    }
  } else {
    console.log(`${route}: Quote failed`);
  }
}

console.log(`Best route: ${bestRoute} with ${bestOutput} output`);
```

### Quote All Available Routes

```typescript
// Get quotes for every available route
const allQuotes = await client.swap.getAllRouteQuotes('50000000');  // 0.5 RUNE

// Analyze results
const successful = [...allQuotes.entries()].filter(([, quote]) => quote !== null);
console.log(`${successful.length}/${allQuotes.size} routes available`);

// Group by output asset
const byAsset = new Map<string, Array<[EasyRouteName, SwapQuote]>>();
for (const [route, quote] of successful) {
  if (quote) {
    const outputAsset = EASY_ROUTES[route].to;
    if (!byAsset.has(outputAsset)) byAsset.set(outputAsset, []);
    byAsset.get(outputAsset)!.push([route, quote]);
  }
}

// Show best route for each asset
for (const [asset, routes] of byAsset) {
  const best = routes.reduce((a, b) => 
    BigInt(a[1].expectedOutput) > BigInt(b[1].expectedOutput) ? a : b
  );
  console.log(`Best route to ${asset}: ${best[0]} (${best[1].expectedOutput})`);
}
```

## Cross-Chain Deposits

### Bitcoin Deposit

```typescript
// Generate deposit memo for Bitcoin
const btcMemo = await client.swap.buildL1Memo({
  fromAsset: ASSETS.BTC,
  toAsset: ASSETS.RUNE,
  amount: '100000000',  // 1 BTC
  destination: 'thor1jkl...'
});

console.log('Bitcoin deposit memo:', btcMemo);
// Output: x:thor1fin...:{base64_encoded_message}

// Use this memo when sending Bitcoin to THORChain vault
// The swap will execute automatically when Bitcoin is received
```

### Ethereum Deposit with Contract Call

```typescript
// For ERC20 tokens, you might need additional setup
const ethMemo = await client.swap.buildL1Memo({
  fromAsset: ASSETS.ETH,
  toAsset: ASSETS.USDC,
  amount: '2000000000000000000',  // 2 ETH
  destination: 'thor1mno...'
});

console.log('Ethereum deposit memo:', ethMemo);
```

## Error Handling

### Comprehensive Error Handling

```typescript
async function safeSwap(params: QuoteParams): Promise<SwapResult | null> {
  try {
    // Get quote with validation
    const quote = await client.swap.getQuote(params);
    
    // Check for warnings
    if (quote.warning) {
      console.warn('Quote warning:', quote.warning);
      
      // Decide whether to proceed based on warning type
      if (quote.warning.includes('estimated') && 
          parseFloat(quote.priceImpact) > 5) {
        console.error('Price impact too high with unreliable estimate');
        return null;
      }
    }
    
    // Execute swap
    return await client.swap.execute(quote);
    
  } catch (error) {
    if (error instanceof RujiraError) {
      switch (error.code) {
        case RujiraErrorCode.INSUFFICIENT_BALANCE:
          console.error('Insufficient funds:', error.toUserMessage());
          console.log('Details:', error.details);
          break;
          
        case RujiraErrorCode.QUOTE_EXPIRED:
          console.log('Quote expired, retrying...');
          // Recursive retry with fresh quote
          return await safeSwap(params);
          
        case RujiraErrorCode.NETWORK_ERROR:
          if (error.retryable) {
            console.log('Network error, waiting 2s before retry...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            return await safeSwap(params);
          }
          break;
          
        case RujiraErrorCode.SLIPPAGE_EXCEEDED:
          console.error('Slippage exceeded. Market moved too much.');
          console.log('Try increasing slippage tolerance or reducing amount');
          break;
          
        default:
          console.error('Swap failed:', error.toUserMessage());
      }
    } else {
      console.error('Unexpected error:', error);
    }
    return null;
  }
}

// Usage
const result = await safeSwap({
  fromAsset: ASSETS.RUNE,
  toAsset: ASSETS.USDC,
  amount: '100000000',
  destination: 'thor1pqr...'
});

if (result) {
  console.log('Swap successful:', result.txHash);
}
```

### Retry Logic with Exponential Backoff

```typescript
async function executeWithRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1000
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      // Don't retry certain errors
      if (error instanceof RujiraError) {
        if (!error.retryable) {
          throw error;
        }
      }
      
      // Calculate delay with exponential backoff
      const delay = baseDelayMs * Math.pow(2, attempt);
      console.log(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

// Usage
const quote = await executeWithRetry(() => 
  client.swap.getQuote({
    fromAsset: ASSETS.BTC,
    toAsset: ASSETS.RUNE,
    amount: '25000000'
  })
);
```

## AI Agent Patterns

### Market Analysis Agent

```typescript
class MarketAnalyzer {
  constructor(private client: RujiraClient) {}
  
  async analyzeArbitrageOpportunities(inputAmount: string) {
    // Get all possible routes
    const allQuotes = await this.client.swap.getAllRouteQuotes(inputAmount);
    
    // Find circular arbitrage opportunities
    const opportunities: Array<{
      path: string[];
      profit: bigint;
      profitPercent: number;
    }> = [];
    
    for (const [route1Name, quote1] of allQuotes) {
      if (!quote1) continue;
      
      const route1 = EASY_ROUTES[route1Name];
      const intermediate = route1.to;
      
      // Find routes back to original asset
      const returnRoutes = [...allQuotes.entries()].filter(([routeName, quote]) => {
        if (!quote) return false;
        const route = EASY_ROUTES[routeName];
        return route.from === intermediate && route.to === route1.from;
      });
      
      for (const [route2Name, quote2] of returnRoutes) {
        if (!quote2) continue;
        
        const finalOutput = BigInt(quote2.expectedOutput);
        const initialInput = BigInt(inputAmount);
        
        if (finalOutput > initialInput) {
          const profit = finalOutput - initialInput;
          const profitPercent = Number(profit * 100n / initialInput);
          
          opportunities.push({
            path: [route1Name, route2Name],
            profit,
            profitPercent
          });
        }
      }
    }
    
    return opportunities.sort((a, b) => b.profitPercent - a.profitPercent);
  }
  
  async getLiquidityDepth(baseAsset: string, quoteAsset: string, maxDepthPercent = 5) {
    try {
      const orderbook = await this.client.orderbook.getBook(baseAsset, quoteAsset);
      
      // Calculate depth within price range
      const midPrice = (parseFloat(orderbook.bids[0]?.price || '0') + 
                       parseFloat(orderbook.asks[0]?.price || '0')) / 2;
      
      const maxPriceDeviation = midPrice * (maxDepthPercent / 100);
      
      let bidDepth = 0;
      let askDepth = 0;
      
      for (const bid of orderbook.bids) {
        const price = parseFloat(bid.price);
        if (price >= midPrice - maxPriceDeviation) {
          bidDepth += parseFloat(bid.amount);
        }
      }
      
      for (const ask of orderbook.asks) {
        const price = parseFloat(ask.price);
        if (price <= midPrice + maxPriceDeviation) {
          askDepth += parseFloat(ask.amount);
        }
      }
      
      return { bidDepth, askDepth, midPrice };
    } catch {
      return null;
    }
  }
}

// Usage
const analyzer = new MarketAnalyzer(client);

// Find arbitrage opportunities
const opportunities = await analyzer.analyzeArbitrageOpportunities('100000000');
console.log('Top arbitrage opportunities:', opportunities.slice(0, 3));

// Check market depth
const depth = await analyzer.getLiquidityDepth('btc-btc', 'rune', 2);
if (depth) {
  console.log(`BTC/RUNE liquidity within 2%: ${depth.bidDepth} BTC bids, ${depth.askDepth} BTC asks`);
}
```

### Trading Bot Pattern

```typescript
class SimpleGridBot {
  constructor(
    private client: RujiraClient,
    private baseAsset: string,
    private quoteAsset: string,
    private gridSize: number = 0.01  // 1% grid
  ) {}
  
  async executeGridStrategy(baseAmount: string) {
    try {
      // Get current market price
      const quote = await this.client.swap.getQuote({
        fromAsset: this.baseAsset,
        toAsset: this.quoteAsset,
        amount: baseAmount
      });
      
      const currentRate = parseFloat(quote.rate);
      console.log(`Current rate: 1 ${this.baseAsset} = ${currentRate} ${this.quoteAsset}`);
      
      // Check if we should buy or sell based on grid levels
      const gridLevels = this.calculateGridLevels(currentRate);
      
      for (const level of gridLevels) {
        if (this.shouldExecuteTrade(currentRate, level)) {
          await this.executeTrade(level);
        }
      }
      
    } catch (error) {
      console.error('Grid bot error:', error);
    }
  }
  
  private calculateGridLevels(currentPrice: number) {
    const levels = [];
    for (let i = -5; i <= 5; i++) {
      const priceLevel = currentPrice * (1 + this.gridSize * i);
      levels.push({
        price: priceLevel,
        side: i > 0 ? 'sell' : 'buy',
        amount: this.calculateOrderSize(priceLevel)
      });
    }
    return levels;
  }
  
  private shouldExecuteTrade(currentPrice: number, level: any): boolean {
    // Simplified logic - in practice you'd track filled orders
    if (level.side === 'buy') {
      return currentPrice <= level.price * 0.999; // Execute buy when price drops
    } else {
      return currentPrice >= level.price * 1.001; // Execute sell when price rises
    }
  }
  
  private calculateOrderSize(price: number): string {
    // Fixed size for simplicity - could be dynamic based on portfolio
    return '10000000'; // 0.1 base unit
  }
  
  private async executeTrade(level: any) {
    try {
      if (level.side === 'buy') {
        await this.client.swap.executeSwap({
          fromAsset: this.quoteAsset,
          toAsset: this.baseAsset,
          amount: level.amount,
          destination: await this.client.getAddress()
        });
      } else {
        await this.client.swap.executeSwap({
          fromAsset: this.baseAsset,
          toAsset: this.quoteAsset,
          amount: level.amount,
          destination: await this.client.getAddress()
        });
      }
      console.log(`Executed ${level.side} at ${level.price}`);
    } catch (error) {
      console.error(`Failed to execute ${level.side}:`, error);
    }
  }
}

// Usage
const gridBot = new SimpleGridBot(client, 'btc-btc', 'rune', 0.02);  // 2% grid
await gridBot.executeGridStrategy('50000000');  // 0.5 BTC
```

## Production Patterns

### Connection Management

```typescript
class ProductionRujiraClient {
  private client: RujiraClient | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  
  async initialize(options: RujiraClientOptions) {
    this.client = new RujiraClient(options);
    await this.connectWithRetry();
  }
  
  private async connectWithRetry() {
    while (this.reconnectAttempts < this.maxReconnectAttempts) {
      try {
        await this.client!.connect();
        console.log('Connected successfully');
        this.reconnectAttempts = 0;
        return;
      } catch (error) {
        this.reconnectAttempts++;
        console.log(`Connection attempt ${this.reconnectAttempts} failed:`, error);
        
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
          console.log(`Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    throw new Error('Max reconnection attempts reached');
  }
  
  async executeWithReconnect<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof RujiraError && error.code === RujiraErrorCode.NOT_CONNECTED) {
        console.log('Connection lost, attempting to reconnect...');
        await this.connectWithRetry();
        return await operation();
      }
      throw error;
    }
  }
  
  getClient(): RujiraClient {
    if (!this.client) {
      throw new Error('Client not initialized');
    }
    return this.client;
  }
}

// Usage
const productionClient = new ProductionRujiraClient();
await productionClient.initialize({ network: 'mainnet', signer });

// All operations with automatic reconnection
const quote = await productionClient.executeWithReconnect(() =>
  productionClient.getClient().swap.getQuote({
    fromAsset: ASSETS.RUNE,
    toAsset: ASSETS.USDC,
    amount: '100000000'
  })
);
```

### Performance Monitoring

```typescript
class PerformanceMonitor {
  private metrics = {
    quoteLatency: [] as number[],
    executeLatency: [] as number[],
    cacheHitRate: 0,
    errorRate: 0,
    operations: 0,
    errors: 0
  };
  
  async measureQuote<T>(operation: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      const result = await operation();
      this.recordQuoteLatency(Date.now() - start);
      this.metrics.operations++;
      return result;
    } catch (error) {
      this.recordError(error);
      throw error;
    }
  }
  
  async measureExecution<T>(operation: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      const result = await operation();
      this.recordExecuteLatency(Date.now() - start);
      this.metrics.operations++;
      return result;
    } catch (error) {
      this.recordError(error);
      throw error;
    }
  }
  
  private recordQuoteLatency(ms: number) {
    this.metrics.quoteLatency.push(ms);
    if (this.metrics.quoteLatency.length > 100) {
      this.metrics.quoteLatency.shift();
    }
  }
  
  private recordExecuteLatency(ms: number) {
    this.metrics.executeLatency.push(ms);
    if (this.metrics.executeLatency.length > 100) {
      this.metrics.executeLatency.shift();
    }
  }
  
  private recordError(error: any) {
    this.metrics.errors++;
    this.metrics.errorRate = this.metrics.errors / this.metrics.operations;
  }
  
  getMetrics() {
    const avgQuoteLatency = this.metrics.quoteLatency.length > 0
      ? this.metrics.quoteLatency.reduce((a, b) => a + b) / this.metrics.quoteLatency.length
      : 0;
      
    const avgExecuteLatency = this.metrics.executeLatency.length > 0
      ? this.metrics.executeLatency.reduce((a, b) => a + b) / this.metrics.executeLatency.length
      : 0;
    
    return {
      ...this.metrics,
      avgQuoteLatency,
      avgExecuteLatency
    };
  }
}

// Usage
const monitor = new PerformanceMonitor();

const quote = await monitor.measureQuote(() =>
  client.swap.getQuote({
    fromAsset: ASSETS.RUNE,
    toAsset: ASSETS.USDC,
    amount: '100000000'
  })
);

const result = await monitor.measureExecution(() =>
  client.swap.execute(quote)
);

console.log('Performance metrics:', monitor.getMetrics());
```

This comprehensive example collection covers the most common use cases and patterns for the Rujira SDK, from simple swaps to advanced trading strategies and production deployment patterns.