/**
 * Tests for getCosmosChainSpecific — specifically the dynamic burn-tax
 * computation for TerraClassic USTC (uusd) sends.
 *
 * The burn-tax amount is encoded in ibcDenomTraces.baseDenom so the sync
 * signing-inputs resolver can use it without an async LCD call.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Chain } from '@vultisig/core-chain/Chain'
import { getTerraClassicTaxRate, getTerraClassicTaxCap } from '@vultisig/core-chain/chains/cosmos/terraClassicTax'

// ---------------------------------------------------------------------------
// Mocks — must be at top level for vi.mock hoisting
// ---------------------------------------------------------------------------

vi.mock('@vultisig/core-chain/chains/cosmos/account/getCosmosAccountInfo', () => ({
  getCosmosAccountInfo: vi.fn().mockResolvedValue({
    accountNumber: '42',
    sequence: '7',
    latestBlock: '1234567_0',
  }),
}))

// Partially mock terraClassicTax — stub the LCD fetchers, keep applyTerraClassicTax real.
vi.mock('@vultisig/core-chain/chains/cosmos/terraClassicTax', async (importOriginal) => {
  const real = await importOriginal<typeof import('@vultisig/core-chain/chains/cosmos/terraClassicTax')>()
  return {
    ...real,
    getTerraClassicTaxRate: vi.fn(),
    getTerraClassicTaxCap: vi.fn(),
  }
})

import { getCosmosChainSpecific } from './cosmos.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockWalletCore = {} as any

// Keysign protobuf Coin uses `contractAddress` for the denom id.
// fromCommCoin maps it to AccountCoin.id = contractAddress || undefined.
function makeUstcPayload(toAmount: string) {
  return {
    toAmount,
    coin: {
      chain: Chain.TerraClassic,
      contractAddress: 'uusd', // this becomes AccountCoin.id
      address: 'terra1abc',
      decimals: 6,
      ticker: 'USTC',
    },
  } as any
}

function makeLuncPayload(toAmount: string) {
  return {
    toAmount,
    coin: {
      chain: Chain.TerraClassic,
      contractAddress: '', // native LUNC — id will be undefined
      address: 'terra1abc',
      decimals: 6,
      ticker: 'LUNC',
    },
  } as any
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getCosmosChainSpecific — USTC burn-tax baseDenom encoding', () => {
  beforeEach(() => {
    vi.mocked(getTerraClassicTaxRate).mockReset()
    vi.mocked(getTerraClassicTaxCap).mockReset()
  })

  it('sets baseDenom to "0" when burn-tax rate is zero (current chain state)', async () => {
    vi.mocked(getTerraClassicTaxRate).mockResolvedValue(0n)

    const result = await getCosmosChainSpecific({
      keysignPayload: makeUstcPayload('10000000'),
      transactionType: 0 as any,
      walletCore: mockWalletCore,
    })

    expect(result.ibcDenomTraces?.baseDenom).toBe('0')
    // Cap lookup is skipped when rate is 0 (applyTerraClassicTax early-returns)
    expect(getTerraClassicTaxCap).not.toHaveBeenCalled()
  })

  it('encodes the computed burn-tax amount in baseDenom when rate is non-zero', async () => {
    // 1.2% rate on 10_000_000 uusd = 120_000 uusd
    vi.mocked(getTerraClassicTaxRate).mockResolvedValue(12_000_000_000_000_000n) // 1.2% as 18-decimal Dec
    vi.mocked(getTerraClassicTaxCap).mockResolvedValue(null) // uncapped

    const result = await getCosmosChainSpecific({
      keysignPayload: makeUstcPayload('10000000'),
      transactionType: 0 as any,
      walletCore: mockWalletCore,
    })

    expect(result.ibcDenomTraces?.baseDenom).toBe('120000')
  })

  it('caps the burn-tax at the per-denom cap', async () => {
    vi.mocked(getTerraClassicTaxRate).mockResolvedValue(12_000_000_000_000_000n) // 1.2%
    vi.mocked(getTerraClassicTaxCap).mockResolvedValue(50_000n) // cap lower than 120_000

    const result = await getCosmosChainSpecific({
      keysignPayload: makeUstcPayload('10000000'),
      transactionType: 0 as any,
      walletCore: mockWalletCore,
    })

    expect(result.ibcDenomTraces?.baseDenom).toBe('50000')
  })

  it('falls back to "0" when the burn-tax LCD is unreachable (fail-open)', async () => {
    vi.mocked(getTerraClassicTaxRate).mockRejectedValue(new Error('LCD 503: connection refused'))

    const result = await getCosmosChainSpecific({
      keysignPayload: makeUstcPayload('10000000'),
      transactionType: 0 as any,
      walletCore: mockWalletCore,
    })

    // $0.02 under-fee better than blocked tx when rate is currently 0.
    expect(result.ibcDenomTraces?.baseDenom).toBe('0')
  })

  it('leaves baseDenom empty for non-USTC TerraClassic sends (LUNC is fee-exempt)', async () => {
    const result = await getCosmosChainSpecific({
      keysignPayload: makeLuncPayload('10000000'),
      transactionType: 0 as any,
      walletCore: mockWalletCore,
    })

    expect(getTerraClassicTaxRate).not.toHaveBeenCalled()
    expect(result.ibcDenomTraces?.baseDenom).toBe('')
  })
})
