# Rujira SDK Architecture

## Overview

The Rujira SDK provides a TypeScript interface for interacting with the Rujira DEX on THORChain. It's designed as a modular system where each component has a specific responsibility and clear interfaces.

## Core Principles

### 1. Modular Design
Each feature area (swap, orderbook, discovery) is implemented as a separate module with its own responsibilities:
- **Separation of concerns**: Modules don't directly depend on each other
- **Testability**: Each module can be unit tested in isolation  
- **Extensibility**: New modules can be added without affecting existing functionality
- **Maintainability**: Changes to one module don't cascade through the system

### 2. Asset Format Consistency
The SDK uses **on-chain denominations** throughout:
- **Format**: Lowercase, hyphen-separated (e.g., `btc-btc`, `eth-usdc-0xa0b86991...`, `rune`)
- **Why**: What you write is what goes on-chain, eliminating conversion errors
- **Benefit**: Consistent with THORChain ecosystem, simplifies debugging

### 3. Error-First Design
Comprehensive error handling with categorized error codes:
- **Predictable failures**: Network issues, validation errors, insufficient funds
- **Descriptive messages**: Clear error descriptions for debugging
- **Retry logic**: Automatic retry for transient network issues
- **User-friendly**: Simplified error messages for end users

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        RujiraClient                              │
│                   (Central Coordinator)                         │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Swap       │  │  Orderbook   │  │     Discovery        │  │
│  │   Module     │  │   Module     │  │      Module          │  │
│  │              │  │              │  │                      │  │
│  │ - Quoting    │  │ - Book data  │  │ - Contract finding   │  │
│  │ - Execution  │  │ - Depth      │  │ - GraphQL + Chain    │  │
│  │ - Caching    │  │ - Spreads    │  │ - Caching            │  │
│  │ - Validation │  │              │  │                      │  │
│  └──────┬───────┘  └──────────────┘  └──────────┬───────────┘  │
│         │                                        │              │
│         ▼                                        ▼              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Contract Discovery Layer                    │   │
│  │   Primary: GraphQL API (api.rujira.network)             │   │
│  │   Fallback: Chain Query (thornode.ninerealms.com)       │   │
│  │   Cache: 5min TTL, concurrent request deduplication     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                             │                                   │
│                             ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Network Layer (CosmJS)                      │   │
│  │  ┌─────────────────┐    ┌─────────────────────────────┐  │   │
│  │  │  Query Client   │    │   Signing Client            │  │   │
│  │  │  (Read-only)    │    │   (Transactions)            │  │   │
│  │  │                 │    │                             │  │   │
│  │  │ - Balances      │    │ - Contract execution        │  │   │
│  │  │ - Contract      │    │ - Transaction signing       │  │   │
│  │  │   queries       │    │ - Gas estimation            │  │   │
│  │  │ - Chain state   │    │ - Broadcast                 │  │   │
│  │  └─────────────────┘    └─────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                             │                                   │
│                             ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Signer Layer                               │   │
│  │              VultisigRujiraProvider                      │   │
│  │              (CosmJS-compatible signer)                  │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Module Breakdown

### RujiraClient (Central Coordinator)
**Purpose**: Main entry point that coordinates all operations

**Responsibilities**:
- Network connection management (RPC, WebSocket)
- Module initialization and dependency injection
- Authentication state management
- Configuration management
- Error handling and recovery

**Key Methods**:
- `connect()`: Establishes network connections
- `getBalance()`: Queries user balances
- `queryContract()`: Generic contract interaction
- `executeContract()`: Transaction execution

### Discovery Module
**Purpose**: Automatically finds FIN contract addresses for trading pairs

**Why it exists**: FIN contracts are deployed dynamically as new markets are created. Contract addresses aren't predictable and must be discovered.

**Strategy**:
1. **Primary**: GraphQL API query (fast, metadata-rich)
2. **Fallback**: Direct chain queries (slower, decentralized)
3. **Caching**: 5-minute TTL with deduplication
4. **Validation**: Verify contract code hashes

**Key Methods**:
- `discoverContracts()`: Find all available markets
- `findMarket()`: Locate specific trading pair
- `getContractAddress()`: Get contract for asset pair

### Swap Module  
**Purpose**: Execute market swaps with quote generation and price protection

**Quote Process**:
1. **Discovery**: Find FIN contract for the trading pair
2. **Simulation**: Call contract's `simulate` function for output prediction
3. **Orderbook**: Fetch market depth for price impact calculation
4. **Validation**: Check user balance and address format
5. **Caching**: Store quote for reuse within 30-second expiry

**Safety Features**:
- Quote expiry prevents stale price execution
- Slippage protection with minimum output guarantees
- Balance validation before transaction submission
- Price impact warnings for large trades

**Key Methods**:
- `getQuote()`: Generate swap quotes with caching
- `execute()`: Execute pre-generated quotes
- `executeSwap()`: One-shot quote + execute
- `easySwap()`: Simplified interface for common routes

### Assets Module
**Purpose**: Asset metadata and balance management

**Key Features**:
- Asset format normalization (on-chain denom ↔ display format)
- Balance queries with proper decimal handling
- Metadata lookup (decimals, tickers, contract addresses)

### Orderbook Module
**Purpose**: Access live order book data from FIN contracts

**Features**:
- Real-time bid/ask data
- Market depth analysis  
- Spread calculations
- Price level aggregation

### Deposit/Withdraw Modules
**Purpose**: Cross-chain asset management (L1 ↔ THORChain)

**Deposit Flow**: External chain → THORChain vault → Secured balance
**Withdraw Flow**: Secured balance → THORChain vault → External chain

## Easy Routes System

### Purpose
Provides a simplified interface for common trading pairs, designed specifically for AI agents and programmatic trading.

### Route Design
- **Predictable identifiers**: `RUNE_TO_USDC`, `BTC_TO_ETH`, etc.
- **Battle-tested pairs**: Only routes with proven liquidity
- **Time estimates**: Realistic execution timeframes including L1 confirmations
- **Batch operations**: Quote multiple routes simultaneously

### Benefits for AI Agents
- **No asset discovery needed**: Routes are pre-configured
- **Consistent interfaces**: Same method signatures across all routes  
- **Error resilience**: Partial failures don't break batch operations
- **Performance optimized**: Caching reduces redundant API calls

## Data Flow

### Read Operations (Quotes)
```
User Request
    ↓
Easy Route Resolution (if applicable)
    ↓
Contract Discovery (cached)
    ↓
Parallel: Simulation + Orderbook Query
    ↓
Price Impact Calculation
    ↓
Quote Generation + Caching
    ↓
Response to User
```

### Write Operations (Swaps)
```
Quote Validation (expiry, balance)
    ↓
Transaction Building
    ↓
Signer Integration (VultisigProvider)
    ↓
Gas Estimation
    ↓
Transaction Signing
    ↓
Broadcast to Network
    ↓
Transaction Monitoring
    ↓
Result Callback
```

## Error Handling Strategy

### Error Categories
1. **Network Errors**: RPC failures, timeouts, connectivity issues
2. **Validation Errors**: Invalid assets, addresses, amounts
3. **Business Logic Errors**: Insufficient balance, quote expiry
4. **Contract Errors**: Failed execution, slippage exceeded

### Error Recovery
- **Automatic retry**: For transient network issues
- **Fallback mechanisms**: Discovery module uses chain queries when GraphQL fails
- **Graceful degradation**: Return partial results rather than complete failure
- **User-friendly messages**: Convert technical errors to actionable feedback

## Caching Strategy

### Quote Cache
- **TTL**: 30 seconds (quote expiry)
- **Key**: fromAsset + toAsset + amount
- **Invalidation**: Automatic expiry, manual clear
- **Concurrency**: Deduplication of identical pending requests

### Discovery Cache  
- **TTL**: 5 minutes (contract addresses change rarely)
- **Key**: Network + contract type
- **Invalidation**: Manual refresh, network switching
- **Fallback**: Cache miss triggers fresh discovery

### Balance Cache
- **TTL**: 30 seconds (balances change frequently)
- **Key**: address + denom
- **Invalidation**: Transaction execution, manual refresh

## Security Considerations

### Transaction Safety
- **Quote expiry**: Prevents stale price execution
- **Slippage protection**: Enforces minimum output requirements
- **Balance validation**: Multiple checkpoints prevent failed transactions
- **Gas estimation**: Prevents failed transactions due to insufficient gas

### Network Security
- **RPC endpoint validation**: Verify network matches expected chain ID
- **Contract verification**: Check code hashes against known deployments
- **Signer isolation**: Vultisig provider maintains key security

### API Security
- **GraphQL fallback**: Reduces single point of failure
- **Input validation**: Sanitize all user inputs before processing
- **Error sanitization**: Prevent information leakage in error messages

## Performance Optimizations

### Concurrent Operations
- **Parallel discovery**: Query multiple contracts simultaneously
- **Batch quotes**: Process multiple route quotes in parallel
- **Request deduplication**: Share results between concurrent identical requests

### Caching Layers
- **Multi-level caching**: Quotes, discovery, balances
- **Smart invalidation**: Balance cache clears on transactions
- **Background refresh**: Proactive cache warming for popular pairs

### Network Efficiency
- **Connection pooling**: Reuse RPC connections across operations
- **Compression**: Enable gzip for GraphQL responses
- **Request batching**: Combine multiple queries where possible

## Future Extensibility

### Plugin Architecture
- **Signer plugins**: Support for different wallet types
- **Price feed plugins**: Multiple price data sources
- **Analytics plugins**: Trading metrics and insights

### Protocol Evolution
- **Version compatibility**: Handle breaking contract changes
- **Feature flags**: Gradual rollout of new functionality
- **Migration helpers**: Assist users in protocol upgrades

This architecture provides a robust, scalable foundation for DEX interactions while maintaining simplicity for end users and reliability for production applications.