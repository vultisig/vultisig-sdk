# Contributing to Rujira SDK

We welcome contributions to the Rujira SDK! This guide will help you get started with development, testing, and submitting changes.

## Table of Contents

1. [Development Setup](#development-setup)
2. [Project Structure](#project-structure)
3. [Development Workflow](#development-workflow)
4. [Coding Standards](#coding-standards)
5. [Testing](#testing)
6. [Documentation](#documentation)
7. [Submitting Changes](#submitting-changes)
8. [Release Process](#release-process)

## Development Setup

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Git
- TypeScript knowledge
- Basic understanding of Cosmos SDK and CosmWasm

### Local Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/vultisig/vultisig-sdk.git
   cd vultisig-sdk/packages/rujira
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the project**
   ```bash
   npm run build
   ```

4. **Run tests**
   ```bash
   npm test
   ```

5. **Start development mode**
   ```bash
   npm run dev  # Watches for changes and rebuilds
   ```

### Environment Setup

For testing against live networks:

```typescript
const client = new RujiraClient({
  debug: true,
});
```

To test transactions, provide a signer:

```typescript
const client = new RujiraClient({
  signer: yourTestSigner,
  debug: true,
});
```

## Project Structure

### Directory Layout

```
src/
├── client.ts              # Main RujiraClient class
├── config.ts              # Network configurations
├── easy-routes.ts         # Simplified route definitions
├── errors.ts              # Error handling and codes
├── index.ts               # Public API exports
├── types.ts               # Core type definitions
├── discovery/             # Contract discovery module
│   ├── discovery.ts       # Main discovery logic
│   ├── graphql-client.ts  # GraphQL API client
│   ├── index.ts           # Module exports
│   └── types.ts           # Discovery-specific types
├── modules/               # Core functionality modules
│   ├── assets.ts          # Asset metadata and balances
│   ├── deposit.ts         # Cross-chain deposits
│   ├── index.ts           # Module exports
│   ├── orderbook.ts       # Orderbook data access
│   ├── swap.ts            # Market swap operations
│   └── withdraw.ts        # Cross-chain withdrawals
├── signer/                # Transaction signing
│   ├── index.ts           # Signer exports
│   ├── types.ts           # Signer interfaces
│   └── vultisig-provider.ts # Vultisig integration
├── utils/                 # Utility functions
│   ├── cache.ts           # Caching implementation
│   ├── format.ts          # Number/string formatting
│   ├── index.ts           # Utility exports
│   └── memo.ts            # Transaction memo generation
└── __tests__/             # Test files
    ├── *.test.ts          # Unit tests
    └── test-helpers.ts    # Test utilities
```

### Module Responsibilities

- **client.ts**: Central coordinator, network management
- **discovery/**: Finding FIN contract addresses dynamically
- **modules/swap**: Core swap functionality with quotes and execution
- **modules/orderbook**: Live market data from FIN contracts
- **easy-routes.ts**: Simplified API for common trading pairs
- **config.ts**: Network-specific configuration and asset metadata
- **errors.ts**: Comprehensive error handling with categorization
- **signer/**: Vultisig wallet integration for transaction signing

## Development Workflow

### Branch Strategy

- `main`: Production-ready code
- `develop`: Integration branch for features
- `feature/xyz`: Individual feature branches
- `fix/abc`: Bug fix branches

### Making Changes

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Follow coding standards (see below)
   - Add tests for new functionality
   - Update documentation as needed

3. **Test your changes**
   ```bash
   npm run test          # Run all tests
   npm run test:watch    # Watch mode for development
   npm run lint          # Check code style
   npm run typecheck     # Verify TypeScript types
   ```

4. **Build and verify**
   ```bash
   npm run build
   npm run clean && npm run build  # Clean rebuild
   ```

### Asset Format Guidelines

**Always use on-chain denominations:**
- ✅ `'rune'`, `'btc-btc'`, `'eth-usdc-0xa0b86991...'`
- ❌ `'THOR.RUNE'`, `'BTC.BTC'`, `'ETH.USDC'`

**Why**: On-chain denoms eliminate conversion errors and work consistently across THORChain integrations.

### Error Handling Patterns

1. **Use RujiraError for all library errors**
   ```typescript
   throw new RujiraError(
     RujiraErrorCode.INVALID_AMOUNT,
     'Amount must be positive',
     { amount, asset }
   );
   ```

2. **Categorize errors appropriately**
   - Network issues → `NETWORK_ERROR`
   - User input validation → `INVALID_*`
   - Business logic → `INSUFFICIENT_BALANCE`, `QUOTE_EXPIRED`

3. **Mark retryable errors**
   ```typescript
   throw new RujiraError(
     RujiraErrorCode.NETWORK_ERROR,
     'Request failed',
     error,
     true  // retryable
   );
   ```

## Coding Standards

### TypeScript Style

- Use strict TypeScript settings
- Prefer `interface` over `type` for object shapes
- Use `const assertions` for literal types
- Document all public APIs with JSDoc

### Code Organization

1. **Imports**: Group external, internal, relative
   ```typescript
   // External dependencies
   import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate';
   
   // Internal modules
   import { RujiraError, RujiraErrorCode } from '../errors';
   
   // Relative imports
   import type { QuoteParams } from './types';
   ```

2. **Class structure**:
   ```typescript
   export class ModuleName {
     // Public properties first
     public readonly config: Config;
     
     // Private properties
     private cache: Map<string, CachedData>;
     
     // Constructor
     constructor(options: Options) { ... }
     
     // Public methods
     async publicMethod(): Promise<Result> { ... }
     
     // Private methods
     private helperMethod(): void { ... }
   }
   ```

3. **Function documentation**:
   ```typescript
   /**
    * Brief description of what the function does
    * 
    * Longer explanation of behavior, edge cases, or important details.
    * Explain WHY something is done, not just WHAT.
    * 
    * @param param1 - Description of parameter
    * @param param2 - Description with default value info
    * @returns Description of return value
    * @throws {RujiraError} When this specific condition occurs
    * 
    * @example
    * ```typescript
    * const result = await functionName(param1, param2);
    * console.log(result.data);
    * ```
    */
   ```

### Comment Guidelines

Focus on **WHY**, not **WHAT**:

```typescript
// ❌ Bad - describes what code does
// Create a new cache instance
const cache = new Map();

// ✅ Good - explains why it's needed
// Cache prevents duplicate concurrent discovery requests
// Multiple callers during discovery share the same promise
const pendingDiscovery = new Map<string, Promise<Contracts>>();
```

## Testing

### Test Structure

Tests are organized by module and functionality:

```
__tests__/
├── address-validation.test.ts    # Address format validation
├── balance-check.test.ts         # Balance query functionality  
├── batch-quoting.test.ts         # Batch quote operations
├── cache.test.ts                 # Caching behavior
├── deposit.test.ts               # Cross-chain deposits
├── easy-swap.test.ts             # Easy route functionality
├── orderbook.test.ts             # Orderbook data access
├── price-impact.test.ts          # Price impact calculations
├── staleness-warning.test.ts     # Quote staleness handling
└── test-helpers.ts               # Shared test utilities
```

### Writing Tests

1. **Unit tests for core logic**:
   ```typescript
   describe('SwapModule', () => {
     describe('getQuote', () => {
       it('should return valid quote for known pair', async () => {
         const quote = await swap.getQuote({
           fromAsset: 'rune',
           toAsset: 'btc-btc',
           amount: '100000000'
         });
         
         expect(quote.expectedOutput).toBeDefined();
         expect(BigInt(quote.expectedOutput)).toBeGreaterThan(0n);
       });
       
       it('should throw for invalid amount', async () => {
         await expect(swap.getQuote({
           fromAsset: 'rune',
           toAsset: 'btc-btc',
           amount: '0'
         })).rejects.toThrow(RujiraError);
       });
     });
   });
   ```

2. **Integration tests for end-to-end flows**:
   ```typescript
   describe('End-to-End Swap', () => {
     it('should complete full swap workflow', async () => {
       const quote = await client.swap.getQuote(params);
       const result = await client.swap.execute(quote);
       
       expect(result.txHash).toMatch(/^[A-F0-9]{64}$/i);
       expect(result.status).toBe('pending');
     });
   });
   ```

3. **Error condition tests**:
   ```typescript
   describe('Error Handling', () => {
     it('should handle network failures gracefully', async () => {
       // Mock network failure
       jest.spyOn(client, 'queryContract').mockRejectedValue(new Error('Network error'));
       
       await expect(swap.getQuote(params)).rejects.toThrow(
         expect.objectContaining({
           code: RujiraErrorCode.NETWORK_ERROR,
           retryable: true
         })
       );
     });
   });
   ```

### Test Configuration

Tests use Vitest for fast execution and TypeScript support:

```typescript
// vitest.config.ts
export default {
  test: {
    environment: 'node',
    timeout: 30000,  // Allow time for network operations
    setupFiles: ['./src/__tests__/setup.ts']
  }
};
```

### Running Tests

```bash
# All tests
npm test

# Watch mode (for development)
npm run test:watch

# Specific test file
npm test -- address-validation.test.ts

# With coverage
npm test -- --coverage
```

## Documentation

### JSDoc Standards

All public APIs must have JSDoc comments:

```typescript
/**
 * Execute a swap using pre-generated quote
 * 
 * This method validates the quote hasn't expired and executes the swap
 * on the appropriate FIN contract. Quote validation includes checking
 * expiry time and user balance to prevent failed transactions.
 * 
 * @param quote - Quote from getQuote() method
 * @param options - Execution options (slippage override, memo, etc.)
 * @returns Promise resolving to swap result with transaction hash
 * @throws {RujiraError} QUOTE_EXPIRED if quote has expired
 * @throws {RujiraError} INSUFFICIENT_BALANCE if balance too low
 * @throws {RujiraError} CONTRACT_ERROR if execution fails
 * 
 * @example
 * ```typescript
 * const quote = await client.swap.getQuote({...});
 * const result = await client.swap.execute(quote, {
 *   slippageBps: 200,  // Override to 2% slippage
 *   memo: 'My trade'
 * });
 * console.log(`Swap submitted: ${result.txHash}`);
 * ```
 */
async execute(quote: SwapQuote, options: SwapOptions = {}): Promise<SwapResult>
```

### README Updates

When adding features, update the README:

1. **New easy routes**: Add to the routes table
2. **New methods**: Add examples in appropriate sections
3. **Breaking changes**: Document migration path

### Documentation Files

- `README.md`: User-facing documentation and quick start
- `docs/ARCHITECTURE.md`: System design and module relationships
- `docs/EXAMPLES.md`: Comprehensive usage examples
- `docs/API.md`: Complete API reference
- `CONTRIBUTING.md`: This file

## Submitting Changes

### Pull Request Process

1. **Create descriptive PR title**
   ```
   feat(swap): add batch quote functionality
   fix(discovery): handle GraphQL timeout errors
   docs(readme): update installation instructions
   ```

2. **Write comprehensive PR description**
   ```markdown
   ## Summary
   Brief description of changes
   
   ## Motivation
   Why this change is needed
   
   ## Changes
   - List of specific changes made
   - Breaking changes (if any)
   
   ## Testing
   - Unit tests added/updated
   - Manual testing performed
   
   ## Documentation
   - README updated
   - JSDoc comments added
   ```

3. **Ensure CI passes**
   - All tests pass
   - Linting succeeds
   - Type checking passes
   - Build completes

### Review Process

1. **Automated checks** must pass
2. **Code review** by maintainer
3. **Documentation review** for public API changes
4. **Manual testing** for complex features

### Commit Messages

Use conventional commits:
- `feat(scope): description` - New features
- `fix(scope): description` - Bug fixes
- `docs(scope): description` - Documentation changes
- `test(scope): description` - Test additions/changes
- `refactor(scope): description` - Code refactoring
- `perf(scope): description` - Performance improvements

## Release Process

### Version Bumping

We follow semantic versioning:
- **Major** (1.0.0): Breaking changes
- **Minor** (0.1.0): New features, backward compatible
- **Patch** (0.0.1): Bug fixes

### Release Checklist

1. **Pre-release testing**
   - All tests pass
   - Manual testing on mainnet

2. **Documentation updates**
   - CHANGELOG.md updated
   - README.md reflects new features
   - API documentation current

3. **Version bump**
   ```bash
   npm version patch|minor|major
   ```

4. **Publish to npm**
   ```bash
   npm publish
   ```

5. **Create GitHub release**
   - Tag the release
   - Add release notes
   - Include breaking change migration guide

### Breaking Changes

When introducing breaking changes:

1. **Deprecate first** (if possible)
2. **Document migration path**
3. **Provide compatibility layer** (temporary)
4. **Update examples and documentation**

Example deprecation:
```typescript
/**
 * @deprecated Use getQuote() instead. Will be removed in v2.0.0
 * @see getQuote
 */
async quote(params: LegacyParams): Promise<LegacyQuote> {
  console.warn('quote() is deprecated, use getQuote() instead');
  return this.getQuote(migrateParams(params));
}
```

## Getting Help

- **GitHub Issues**: Bug reports and feature requests
- **Discussions**: Questions and community support
- **Discord**: Real-time chat with maintainers
- **Documentation**: Start with README.md and docs/ folder

## Code of Conduct

We follow the standard open source code of conduct:
- Be respectful and inclusive
- Focus on constructive feedback
- Collaborate effectively
- Help others learn and grow

Thank you for contributing to Rujira SDK! 🚀