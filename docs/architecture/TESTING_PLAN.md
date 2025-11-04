# SDK Testing Plan: Functional Adapter Approach

**Last Updated:** 2025-11-03
**Status:** Planning
**Coverage Target:** 90%+

---

## Overview

The functional adapter approach provides **excellent testability** through:
- Pure, stateless adapter functions
- Easy-to-mock core functions
- Independent layer testing
- Simple integration tests

---

## Test Structure

```
packages/sdk/src/
├── vault/
│   ├── adapters/
│   │   ├── formatBalance.test.ts      # Unit tests (pure functions)
│   │   ├── formatGasInfo.test.ts      # Unit tests (pure functions)
│   │   └── buildKeysignPayload.test.ts
│   ├── services/
│   │   ├── CacheService.test.ts       # Unit tests
│   │   └── FastSigningService.test.ts # Integration tests (mock server)
│   └── Vault.test.ts                  # Integration tests (mock core)
├── chains/
│   └── config/
│       └── ChainConfig.test.ts        # Unit tests
└── __integration__/
    ├── vault-address.test.ts          # Real core, all chains
    ├── vault-balance.test.ts          # Real core, all chains
    └── vault-signing.test.ts          # Real core + mock server
```

---

## Unit Tests (Pure Functions)

### 1. Adapter Tests

**File:** `packages/sdk/src/vault/adapters/formatBalance.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { formatBalance } from './formatBalance'

describe('formatBalance', () => {
  it('formats native balance for EVM chain', () => {
    const result = formatBalance(
      1000000000000000000n, // 1 ETH in wei
      'Ethereum'
    )

    expect(result).toEqual({
      amount: '1000000000000000000',
      symbol: 'ETH',
      decimals: 18,
      chainId: 'Ethereum',
      tokenId: undefined
    })
  })

  it('formats native balance for UTXO chain', () => {
    const result = formatBalance(
      100000000n, // 1 BTC in satoshis
      'Bitcoin'
    )

    expect(result).toEqual({
      amount: '100000000',
      symbol: 'BTC',
      decimals: 8,
      chainId: 'Bitcoin',
      tokenId: undefined
    })
  })

  it('formats token balance with metadata', () => {
    const tokens = {
      Ethereum: [
        { id: 'USDC', symbol: 'USDC', decimals: 6, name: 'USD Coin' }
      ]
    }

    const result = formatBalance(
      1000000n, // 1 USDC
      'Ethereum',
      'USDC',
      tokens
    )

    expect(result).toEqual({
      amount: '1000000',
      symbol: 'USDC',
      decimals: 6,
      chainId: 'Ethereum',
      tokenId: 'USDC'
    })
  })

  it('falls back to defaults for unknown token', () => {
    const result = formatBalance(
      1000000n,
      'Ethereum',
      'UNKNOWN',
      {}
    )

    expect(result.decimals).toBe(18) // Default
    expect(result.symbol).toBe('UNKNOWN') // Uses tokenId
  })

  it('handles zero balance', () => {
    const result = formatBalance(0n, 'Ethereum')
    expect(result.amount).toBe('0')
  })

  it('handles large balances', () => {
    const result = formatBalance(
      123456789012345678901234567890n,
      'Ethereum'
    )
    expect(result.amount).toBe('123456789012345678901234567890')
  })
})
```

**File:** `packages/sdk/src/vault/adapters/formatGasInfo.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { formatGasInfo } from './formatGasInfo'

describe('formatGasInfo', () => {
  it('formats EVM gas info with EIP-1559', () => {
    const feeQuote = {
      gasPrice: 50000000000n,
      gasPriceGwei: '50',
      maxFeePerGas: 60000000000n,
      priorityFee: 2000000000n
    }

    const result = formatGasInfo(feeQuote, 'Ethereum')

    expect(result).toMatchObject({
      chainId: 'Ethereum',
      gasPrice: '50000000000',
      gasPriceGwei: '50',
      maxFeePerGas: '60000000000',
      priorityFee: '2000000000'
    })
    expect(result.lastUpdated).toBeCloseTo(Date.now(), -2)
  })

  it('formats UTXO gas info', () => {
    const feeQuote = 5000n // sats per byte

    const result = formatGasInfo(feeQuote, 'Bitcoin')

    expect(result).toMatchObject({
      chainId: 'Bitcoin',
      gasPrice: '5000'
    })
  })

  it('formats Cosmos gas info', () => {
    const feeQuote = 25000n

    const result = formatGasInfo(feeQuote, 'Cosmos')

    expect(result).toMatchObject({
      chainId: 'Cosmos',
      gasPrice: '25000'
    })
  })
})
```

### 2. CacheService Tests

**File:** `packages/sdk/src/vault/services/CacheService.test.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CacheService } from './CacheService'

describe('CacheService', () => {
  let cache: CacheService

  beforeEach(() => {
    cache = new CacheService()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stores and retrieves values', () => {
    cache.set('key', 'value')
    expect(cache.get('key', Infinity)).toBe('value')
  })

  it('returns undefined for missing keys', () => {
    expect(cache.get('missing', Infinity)).toBeUndefined()
  })

  it('respects TTL', () => {
    cache.set('key', 'value')

    // Within TTL
    vi.advanceTimersByTime(4 * 60 * 1000) // 4 minutes
    expect(cache.get('key', 5 * 60 * 1000)).toBe('value')

    // After TTL
    vi.advanceTimersByTime(2 * 60 * 1000) // +2 minutes = 6 total
    expect(cache.get('key', 5 * 60 * 1000)).toBeUndefined()
  })

  it('clears single key', () => {
    cache.set('key1', 'value1')
    cache.set('key2', 'value2')

    cache.clear('key1')

    expect(cache.get('key1', Infinity)).toBeUndefined()
    expect(cache.get('key2', Infinity)).toBe('value2')
  })

  it('clears all keys', () => {
    cache.set('key1', 'value1')
    cache.set('key2', 'value2')

    cache.clearAll()

    expect(cache.get('key1', Infinity)).toBeUndefined()
    expect(cache.get('key2', Infinity)).toBeUndefined()
  })

  it('supports infinite TTL', () => {
    cache.set('permanent', 'value')

    vi.advanceTimersByTime(365 * 24 * 60 * 60 * 1000) // 1 year

    expect(cache.get('permanent', Infinity)).toBe('value')
  })
})
```

### 3. ChainConfig Tests

**File:** `packages/sdk/src/chains/config/ChainConfig.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { ChainConfig } from './ChainConfig'

describe('ChainConfig', () => {
  it('gets chain enum', () => {
    expect(ChainConfig.getChainEnum('Ethereum')).toBe(Chain.Ethereum)
    expect(ChainConfig.getChainEnum('ethereum')).toBe(Chain.Ethereum) // Case insensitive
    expect(ChainConfig.getChainEnum('eth')).toBe(Chain.Ethereum) // Alias
  })

  it('gets chain metadata', () => {
    const meta = ChainConfig.getMetadata('Ethereum')
    expect(meta.symbol).toBe('ETH')
    expect(meta.decimals).toBe(18)
    expect(meta.type).toBe('evm')
  })

  it('validates supported chains', () => {
    expect(ChainConfig.isSupported('Ethereum')).toBe(true)
    expect(ChainConfig.isSupported('InvalidChain')).toBe(false)
  })

  it('gets all supported chains', () => {
    const chains = ChainConfig.getSupportedChains()
    expect(chains).toHaveLength(34)
    expect(chains).toContain('Ethereum')
    expect(chains).toContain('Bitcoin')
  })

  it('gets chains by type', () => {
    const evmChains = ChainConfig.getEvmChains()
    expect(evmChains).toHaveLength(11)
    expect(evmChains).toContain('Ethereum')

    const utxoChains = ChainConfig.getUtxoChains()
    expect(utxoChains).toHaveLength(6)
    expect(utxoChains).toContain('Bitcoin')
  })
})
```

---

## Integration Tests (Mock Core)

### Vault Tests with Mocked Core Functions

**File:** `packages/sdk/src/vault/Vault.test.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Vault } from './Vault'
import { getCoinBalance } from '@core/chain/coin/balance'
import { deriveAddress } from '@core/chain/publicKey/address/deriveAddress'
import { getPublicKey } from '@core/chain/publicKey/getPublicKey'
import { getFeeQuote } from '@core/chain/feeQuote'

// Mock all core functions
vi.mock('@core/chain/coin/balance')
vi.mock('@core/chain/publicKey/address/deriveAddress')
vi.mock('@core/chain/publicKey/getPublicKey')
vi.mock('@core/chain/feeQuote')

describe('Vault', () => {
  let vault: Vault
  let mockVaultData: any
  let mockServices: any

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks()

    // Mock return values
    vi.mocked(getPublicKey).mockReturnValue({} as any)
    vi.mocked(deriveAddress).mockResolvedValue('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb')
    vi.mocked(getCoinBalance).mockResolvedValue(1000000000000000000n)
    vi.mocked(getFeeQuote).mockResolvedValue({ gasPrice: 50000000000n })

    // Create mock vault data
    mockVaultData = {
      name: 'Test Vault',
      publicKeys: {
        ecdsa: '0x123',
        eddsa: '0x456'
      },
      hexChainCode: '0xabc',
      signers: ['Server-123'],
      createdAt: Date.now()
    }

    // Create mock services
    mockServices = {
      wasmManager: {
        getWalletCore: vi.fn().mockResolvedValue({})
      },
      fastSigningService: {}
    }

    vault = new Vault(mockVaultData, mockServices)
  })

  describe('address()', () => {
    it('derives address using core', async () => {
      const address = await vault.address('Ethereum')

      expect(address).toBe('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb')
      expect(deriveAddress).toHaveBeenCalledWith({
        chain: Chain.Ethereum,
        publicKey: expect.anything(),
        walletCore: expect.anything()
      })
    })

    it('caches addresses permanently', async () => {
      const addr1 = await vault.address('Ethereum')
      const addr2 = await vault.address('Ethereum')

      expect(addr1).toBe(addr2)
      expect(deriveAddress).toHaveBeenCalledTimes(1) // Only called once!
    })

    it('derives different addresses for different chains', async () => {
      vi.mocked(deriveAddress).mockResolvedValueOnce('0xETH...')
      vi.mocked(deriveAddress).mockResolvedValueOnce('bc1qBTC...')

      const ethAddr = await vault.address('Ethereum')
      const btcAddr = await vault.address('Bitcoin')

      expect(ethAddr).toBe('0xETH...')
      expect(btcAddr).toBe('bc1qBTC...')
      expect(deriveAddress).toHaveBeenCalledTimes(2)
    })

    it('throws VaultError on derivation failure', async () => {
      vi.mocked(deriveAddress).mockRejectedValue(new Error('Core error'))

      await expect(vault.address('Ethereum')).rejects.toThrow(VaultError)
      await expect(vault.address('Ethereum')).rejects.toMatchObject({
        code: VaultErrorCode.AddressDerivationFailed
      })
    })
  })

  describe('balance()', () => {
    it('fetches balance using core', async () => {
      const balance = await vault.balance('Ethereum')

      expect(balance).toMatchObject({
        amount: '1000000000000000000',
        symbol: 'ETH',
        decimals: 18,
        chainId: 'Ethereum'
      })

      expect(getCoinBalance).toHaveBeenCalledWith({
        chain: Chain.Ethereum,
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        contractAddress: undefined
      })
    })

    it('fetches token balance', async () => {
      vi.mocked(getCoinBalance).mockResolvedValue(1000000n) // 1 USDC

      vault.addToken('Ethereum', {
        id: 'USDC',
        symbol: 'USDC',
        decimals: 6,
        contractAddress: '0xA0b8...'
      })

      const balance = await vault.balance('Ethereum', 'USDC')

      expect(balance).toMatchObject({
        amount: '1000000',
        symbol: 'USDC',
        decimals: 6,
        tokenId: 'USDC'
      })

      expect(getCoinBalance).toHaveBeenCalledWith({
        chain: Chain.Ethereum,
        address: expect.any(String),
        contractAddress: 'USDC'
      })
    })

    it('caches balances with TTL', async () => {
      vi.useFakeTimers()

      await vault.balance('Ethereum')
      expect(getCoinBalance).toHaveBeenCalledTimes(1)

      // Within 5 minutes - hits cache
      vi.advanceTimersByTime(4 * 60 * 1000)
      await vault.balance('Ethereum')
      expect(getCoinBalance).toHaveBeenCalledTimes(1)

      // After 5 minutes - fetches again
      vi.advanceTimersByTime(2 * 60 * 1000)
      await vault.balance('Ethereum')
      expect(getCoinBalance).toHaveBeenCalledTimes(2)

      vi.useRealTimers()
    })

    it('clears cache on updateBalance', async () => {
      await vault.balance('Ethereum')
      expect(getCoinBalance).toHaveBeenCalledTimes(1)

      await vault.updateBalance('Ethereum')
      expect(getCoinBalance).toHaveBeenCalledTimes(2)
    })
  })

  describe('gas()', () => {
    it('estimates gas using core', async () => {
      const gas = await vault.gas('Ethereum')

      expect(gas).toMatchObject({
        chainId: 'Ethereum',
        gasPrice: expect.any(String)
      })

      expect(getFeeQuote).toHaveBeenCalledWith({
        coin: { chain: Chain.Ethereum }
      })
    })
  })

  describe('chain management', () => {
    it('validates chain support', async () => {
      await expect(vault.addChain('InvalidChain')).rejects.toThrow(VaultError)
      await expect(vault.addChain('InvalidChain')).rejects.toMatchObject({
        code: VaultErrorCode.ChainNotSupported
      })
    })

    it('adds supported chain', async () => {
      await vault.addChain('Bitcoin')
      expect(vault.getChains()).toContain('Bitcoin')
    })

    it('pre-derives address when adding chain', async () => {
      await vault.addChain('Bitcoin')
      expect(deriveAddress).toHaveBeenCalledWith({
        chain: Chain.Bitcoin,
        publicKey: expect.anything(),
        walletCore: expect.anything()
      })
    })
  })

  describe('token management', () => {
    it('adds token', () => {
      vault.addToken('Ethereum', {
        id: 'USDC',
        symbol: 'USDC',
        decimals: 6
      })

      expect(vault.getTokens('Ethereum')).toHaveLength(1)
    })

    it('prevents duplicate tokens', () => {
      const token = { id: 'USDC', symbol: 'USDC', decimals: 6 }
      vault.addToken('Ethereum', token)
      vault.addToken('Ethereum', token)

      expect(vault.getTokens('Ethereum')).toHaveLength(1)
    })

    it('removes token', () => {
      vault.addToken('Ethereum', { id: 'USDC', symbol: 'USDC', decimals: 6 })
      vault.removeToken('Ethereum', 'USDC')

      expect(vault.getTokens('Ethereum')).toHaveLength(0)
    })
  })
})
```

---

## End-to-End Integration Tests (Real Core)

### Address Derivation Integration

**File:** `packages/sdk/src/__integration__/vault-address.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { Vultisig } from '../VultisigSDK'

describe('Vault Address Integration (Real Core)', () => {
  let vultisig: Vultisig
  let vault: Vault

  beforeAll(async () => {
    vultisig = new Vultisig()
    await vultisig.initialize()

    // Create test vault with known keys
    vault = await vultisig.createFastVault({
      name: 'Integration Test',
      email: 'test@example.com',
      password: 'test123'
    })
  })

  describe('EVM chains', () => {
    const evmChains = [
      'Ethereum', 'Arbitrum', 'Base', 'Blast', 'Optimism',
      'Zksync', 'Polygon', 'BSC', 'Avalanche', 'Mantle', 'Cronos'
    ]

    evmChains.forEach(chain => {
      it(`derives valid ${chain} address`, async () => {
        const address = await vault.address(chain)

        // EVM addresses start with 0x and are 42 chars
        expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/)
      })
    })
  })

  describe('UTXO chains', () => {
    it('derives valid Bitcoin address', async () => {
      const address = await vault.address('Bitcoin')
      expect(address).toMatch(/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/)
    })

    it('derives valid Litecoin address', async () => {
      const address = await vault.address('Litecoin')
      expect(address).toMatch(/^(ltc1|[LM])[a-zA-HJ-NP-Z0-9]{25,62}$/)
    })
  })

  describe('Other chains', () => {
    it('derives valid Solana address', async () => {
      const address = await vault.address('Solana')
      expect(address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
    })

    it('derives valid Cosmos address', async () => {
      const address = await vault.address('Cosmos')
      expect(address).toMatch(/^cosmos1[a-z0-9]{38}$/)
    })
  })

  it('caches addresses across calls', async () => {
    const addr1 = await vault.address('Ethereum')
    const addr2 = await vault.address('Ethereum')

    expect(addr1).toBe(addr2)
  })
})
```

---

## Test Coverage Targets

| Layer | Target | Priority |
|-------|--------|----------|
| **Adapters** | 100% | High |
| **CacheService** | 100% | High |
| **ChainConfig** | 100% | High |
| **Vault (unit)** | 90%+ | High |
| **Vault (integration)** | 80%+ | Medium |
| **E2E (all chains)** | 100% | Medium |

---

## Running Tests

```bash
# Unit tests only
npm test -- --run

# Integration tests (requires WASM)
npm test -- --run --integration

# Coverage report
npm test -- --coverage

# Watch mode
npm test

# Specific test file
npm test vault/Vault.test.ts
```

---

## Mock Strategies

### 1. **Core Functions** (Always Mock in Unit Tests)
```typescript
vi.mock('@core/chain/coin/balance')
vi.mock('@core/chain/publicKey/address/deriveAddress')
vi.mock('@core/chain/feeQuote')
```

### 2. **WASM** (Mock in Most Tests)
```typescript
mockServices = {
  wasmManager: {
    getWalletCore: vi.fn().mockResolvedValue({
      // Mock WalletCore methods as needed
    })
  }
}
```

### 3. **Server** (Mock Unless Testing Server Flow)
```typescript
vi.mock('../server/ServerManager')
```

---

## Benefits Over Strategy Pattern Testing

| Benefit | Strategy Pattern | Functional Adapters |
|---------|------------------|---------------------|
| **Pure function tests** | No (instance methods) | Yes (standalone functions) |
| **Setup complexity** | Complex (class instantiation) | Simple (function calls) |
| **Mock count** | ~5-10 per test | ~1-3 per test |
| **Test count** | ~48 (16 strategies × 3) | ~20 (adapters + vault) |
| **Integration tests** | Complex (many mocks) | Simple (mock core) |
| **Maintenance** | Update multiple files | Update one file |

---

## Summary

The functional adapter approach provides **superior testability** because:

✅ **Pure adapter functions** - 100% testable with zero mocks
✅ **Simple mocking** - Just mock core functions (module mocks)
✅ **Independent layers** - Test adapters, Vault, integration separately
✅ **60% fewer tests** - No need to test each strategy class
✅ **Faster tests** - Pure functions are instant, mocks are fast
✅ **Easier debugging** - Clear stack traces, no class hierarchy
✅ **Better coverage** - Focus on actual functionality, not boilerplate

**Result:** Higher quality, faster tests, easier maintenance.
