# Live Verification Tests

Tests that query THORChain mainnet to verify SDK correctness against live data.

## Running Live Tests

```bash
# Run all live tests
LIVE_TESTS=1 yarn workspace @vultisig/rujira test

# Run specific live test file
LIVE_TESTS=1 yarn workspace @vultisig/rujira test src/__tests__/orderside-serialization.test.ts
LIVE_TESTS=1 yarn workspace @vultisig/rujira test src/__tests__/outbound-fee.test.ts
```

## Test Files

### `orderside-serialization.test.ts`
- Verifies FIN contract OrderSide format (base/quote vs buy/sell)
- Queries live FIN contracts to confirm book structure
- **Audit Item:** H1

### `outbound-fee.test.ts`
- Verifies hardcoded fallback fees against THORNode
- Checks all chain fees are within 3x tolerance
- **Audit Item:** L2

## When to Run

1. **After updating hardcoded values** - Verify they match mainnet
2. **Before releases** - Ensure no regression
3. **Periodically** - Detect stale configurations

## Adding New Live Tests

Use the `describe.skipIf(!process.env.LIVE_TESTS)` pattern:

```typescript
describe.skipIf(!process.env.LIVE_TESTS)('Live Test Name', () => {
  it('queries mainnet', async () => {
    const response = await fetch('https://thornode.ninerealms.com/...');
    // assertions
  });
});
```

This ensures tests are skipped in normal CI runs but can be enabled explicitly.
