# @vultisig/assets

Unified asset and decimal handling for THORChain ecosystem layers.

## Why This Package Exists

The THORChain ecosystem operates across three different layers, each with its own asset formatting and decimal precision requirements:

1. **Native L1** - Original blockchain formats (BTC has 8 decimals, ETH has 18, USDC has 6)
2. **THORChain** - Normalized to 8 decimals for all assets (`CHAIN.SYMBOL` format)
3. **Rujira FIN** - Tick precision at 6 decimals (`chain-symbol` format)

Converting between these layers manually is error-prone and complex. This package provides a type-safe, battle-tested solution.

## Quick Start

```typescript
import { createAmount, getAsset, SwapRouter } from '@vultisig/assets';

// Create amounts in different layers
const btc = createAmount('1.5', 'btc', 'native');
const thorchainBtc = btc.toThorchain();
const finBtc = btc.toFin();

console.log(btc.toDisplay());        // "1.5 BTC"
console.log(thorchainBtc.raw);       // 150000000n (8 decimals)
console.log(finBtc.raw);             // 1500000n (6 decimals)

// Get quotes for swaps
const router = new SwapRouter();
const quote = await router.quote(
  getAsset('usdc')!,
  getAsset('btc')!,
  createAmount('1000', 'usdc')
);
console.log(quote.path); // 'rujira-fin' or 'thorchain-lp'
```

## Core Concepts

### Assets

Each asset knows its formats and decimal precision across all layers:

```typescript
interface Asset {
  id: string;              // 'btc', 'usdc', etc
  name: string;            // 'Bitcoin', 'USD Coin'
  chain: string;           // 'bitcoin', 'ethereum', 'thorchain'
  contract?: string;       // ERC20 contract address if applicable
  decimals: {
    native: number;        // Native chain decimals
    thorchain: number;     // Always 8 
    fin: number;           // Usually 6
  };
  formats: {
    l1: string;            // Native format
    thorchain: string;     // 'CHAIN.SYMBOL' or 'CHAIN.SYMBOL-CONTRACT'
    fin: string;           // 'chain-symbol' lowercase
  };
}
```

### Amounts

The `Amount` class handles values with automatic layer conversions:

```typescript
const usdc = createAmount('100.50', 'usdc', 'native');

// Layer conversions
const thorchainUsdc = usdc.toThorchain();
const finUsdc = usdc.toFin();

// Arithmetic (same asset + layer only)
const doubled = usdc.multiply(2);
const total = usdc.add(createAmount('50', 'usdc', 'native'));

// Display
console.log(usdc.toHuman());     // "100.5"
console.log(usdc.toDisplay());   // "100.5 USDC"
```

### Format Conversion

Parse and convert between any asset format:

```typescript
import { parseAsset, convertFormat, detectFormat } from '@vultisig/assets';

// Parse any format
const asset1 = parseAsset('BTC.BTC');           // THORChain format
const asset2 = parseAsset('ethereum-usdc');     // FIN format  
const asset3 = parseAsset('0xA0b86a33E6441e8c673896Cf5F37c0DAc6F2e38d'); // L1 contract

// Convert formats
const thorFormat = convertFormat('bitcoin-btc', 'thorchain'); // "BTC.BTC"
const finFormat = convertFormat('BTC.BTC', 'fin');            // "bitcoin-btc"

// Detect format type
console.log(detectFormat('ETH.USDC-0X...')); // "thorchain"
console.log(detectFormat('ethereum-usdc'));   // "fin"
```

### Swap Routing

The `SwapRouter` automatically selects the best path:

```typescript
const router = new SwapRouter();

// Auto-select path based on asset support:
// - Both assets on THORChain → Rujira FIN (better rates)
// - L1 to L1 swaps → THORChain LP (broader support)
const quote = await router.quote(fromAsset, toAsset, amount);

// Or specify explicit paths
const thorQuote = await router.quoteThorchainLP(fromAsset, toAsset, amount);
const finQuote = await router.quoteRujiraFIN(fromAsset, toAsset, amount);
```

## Supported Assets

- **BTC** - Bitcoin (native: 8 decimals)
- **ETH** - Ethereum (native: 18 decimals)  
- **RUNE** - THORChain (native: 8 decimals)
- **USDC** - USD Coin (native: 6 decimals)
- **USDT** - Tether USD (native: 6 decimals)
- **AVAX** - Avalanche (native: 18 decimals)
- **ATOM** - Cosmos (native: 6 decimals)
- **DOGE** - Dogecoin (native: 8 decimals)
- **LTC** - Litecoin (native: 8 decimals)
- **BCH** - Bitcoin Cash (native: 8 decimals)
- **BNB** - BNB Chain (native: 8 decimals)

## Decimal Conversion Logic

### The Three-Layer Problem

Different systems use different decimal precision:

```
Asset    | Native | THORChain | FIN
---------|--------|-----------|----
BTC      |   8    |     8     |  6
ETH      |  18    |     8     |  6  
USDC     |   6    |     8     |  6
```

### Conversion Formulas

All conversions route through THORChain as the canonical 8-decimal format:

```typescript
// Native → THORChain
// Scale up/down to 8 decimals
thorchainAmount = nativeAmount * 10^(8 - nativeDecimals)

// THORChain → FIN  
// Scale down from 8 to 6
finAmount = thorchainAmount / 10^(8 - 6) = thorchainAmount / 100

// Examples:
// 1 USDC (1000000 native units, 6 dec) → 100000000 THORChain units
// 100000000 THORChain units → 1000000 FIN units
```

## API Reference

### Registry Functions

```typescript
// Get asset by ID
getAsset(id: string): Asset | null

// Get all known assets  
getAllAssets(): Asset[]

// Find asset by any format
findAssetByFormat(format: string): Asset | null
```

### Amount Methods

```typescript
// Factory methods
Amount.from(human: string, asset: Asset, layer: Layer): Amount
Amount.fromRaw(raw: bigint, asset: Asset, layer: Layer): Amount

// Layer conversions
amount.toLayer(target: Layer): Amount
amount.toNative(): Amount  
amount.toThorchain(): Amount
amount.toFin(): Amount

// Arithmetic
amount.add(other: Amount): Amount
amount.subtract(other: Amount): Amount  
amount.multiply(factor: number): Amount

// Display
amount.toHuman(precision?: number): string
amount.toDisplay(precision?: number): string
amount.toRaw(): bigint

// Comparisons
amount.equals(other: Amount): boolean
amount.isZero(): boolean
amount.isPositive(): boolean
```

### Format Functions

```typescript
// Convert asset to specific format
toThorchainFormat(asset: Asset): string
toFinFormat(asset: Asset): string  
toL1Format(asset: Asset): string

// Parse and detect formats
parseAsset(input: string): Asset | null
detectFormat(input: string): 'l1' | 'thorchain' | 'fin' | 'unknown'
convertFormat(input: string, target: Layer): string | null

// THORChain format utilities
extractChainFromThorchain(format: string): string
extractSymbolFromThorchain(format: string): string
extractContractFromThorchain(format: string): string | undefined
buildThorchainFormat(chain: string, symbol: string, contract?: string): string
```

### Router Methods

```typescript
// Auto-select best path
router.quote(from: Asset, to: Asset, amount: Amount): Promise<Quote>

// Explicit paths
router.quoteThorchainLP(from: Asset, to: Asset, amount: Amount): Promise<Quote>
router.quoteRujiraFIN(from: Asset, to: Asset, amount: Amount): Promise<Quote>

// Path utilities
router.getRecommendedPath(from: Asset, to: Asset): 'thorchain-lp' | 'rujira-fin'
router.isPathAvailable(from: Asset, to: Asset, path): boolean
router.getSupportedAssets(path): string[]
```

## Examples

### Basic Usage

```typescript
import { createAmount, parseAmount } from '@vultisig/assets';

// Create from asset ID
const btc = createAmount('1.5', 'btc', 'native');

// Create from any format  
const usdc = parseAmount('100', 'ETH.USDC-0X...', 'thorchain');

// Convert between layers
const nativeUsdc = usdc.toNative();
console.log(nativeUsdc.toDisplay()); // "100 USDC"
```

### Cross-Layer Calculations

```typescript
import { Amount, getAsset } from '@vultisig/assets';

const asset = getAsset('usdc')!;

// Same value, different layers
const native = Amount.from('100.50', asset, 'native');     // 6 decimals
const thorchain = native.toThorchain();                    // 8 decimals  
const fin = native.toFin();                               // 6 decimals

console.log({
  native: native.raw,        // 100500000n (6 decimal places)
  thorchain: thorchain.raw,  // 10050000000n (8 decimal places)  
  fin: fin.raw              // 100500000n (6 decimal places)
});
```

### Format Detection and Conversion

```typescript
import { detectFormat, convertFormat, parseAsset } from '@vultisig/assets';

const inputs = [
  'BTC',                    // L1 format
  'BTC.BTC',               // THORChain format
  'bitcoin-btc',           // FIN format
  '0xA0b86a33...'         // Contract address
];

for (const input of inputs) {
  const format = detectFormat(input);
  const asset = parseAsset(input);
  
  if (asset) {
    console.log(`${input} (${format}) → ${asset.name}`);
    
    // Convert to all formats
    console.log({
      l1: convertFormat(input, 'l1'),
      thorchain: convertFormat(input, 'thorchain'),  
      fin: convertFormat(input, 'fin')
    });
  }
}
```

### Swap Path Selection

```typescript
import { SwapRouter, getAsset } from '@vultisig/assets';

const router = new SwapRouter();
const usdc = getAsset('usdc')!;
const btc = getAsset('btc')!;
const doge = getAsset('doge')!;

// Secured assets (USDC ↔ BTC) → Rujira FIN
console.log(router.getRecommendedPath(usdc, btc)); // 'rujira-fin'

// L1 assets (BTC ↔ DOGE) → THORChain LP
console.log(router.getRecommendedPath(btc, doge));  // 'thorchain-lp'

// Check availability
console.log(router.isPathAvailable(usdc, btc, 'rujira-fin'));    // true
console.log(router.isPathAvailable(btc, doge, 'rujira-fin'));    // false
```

## Development

```bash
# Install dependencies
npm install

# Build the package
npm run build

# Run tests  
npm test

# Type checking
npx tsc --noEmit
```

## License

MIT