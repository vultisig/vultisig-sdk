/**
 * Tests for getCosmosChainSpecific — specifically the denom-aware gas and
 * dynamic burn-tax computation for TerraClassic USTC (uusd) sends.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Chain } from '@vultisig/core-chain/Chain'
import { getCosmosAccountInfo } from '@vultisig/core-chain/chains/cosmos/account/getCosmosAccountInfo'
import { getCosmosFeeAmount } from '@vultisig/core-chain/chains/cosmos/gas'
import { getTerraClassicBurnTaxRate } from '@vultisig/core-chain/chains/cosmos/terraClassicTax'

// ---------------------------------------------------------------------------
// Mocks — must be at top level for vi.mock hoisting
// ---------------------------------------------------------------------------

vi.mock('@vultisig/core-chain/chains/cosmos/account/getCosmosAccountInfo', () => ({
  getCosmosAccountInfo: vi.fn().mockResolvedValue({
    address: 'terra1abc',
    pubkey: null,
    accountNumber: 42n,
    sequence: 7,
    sequenceBigInt: 7n,
    latestBlock: '1234567_0',
  }),
}))

vi.mock('@vultisig/core-chain/chains/cosmos/gas', () => ({
  getCosmosFeeAmount: vi.fn().mockResolvedValue(7500n),
  TERRA_CLASSIC_UUSD_BASE_GAS: 225_000n,
}))

// Partially mock terraClassicTax — stub the LCD fetcher, keep burn-tax math real.
vi.mock('@vultisig/core-chain/chains/cosmos/terraClassicTax', async importOriginal => {
  const real = await importOriginal<typeof import('@vultisig/core-chain/chains/cosmos/terraClassicTax')>()
  return {
    ...real,
    getTerraClassicBurnTaxRate: vi.fn(),
  }
})

import { getCosmosChainSpecific } from './index.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockWalletCore = {} as any

// Keysign protobuf Coin uses `contractAddress` for the denom id.
// fromCommCoin maps it to AccountCoin.id = contractAddress || undefined.
function makeUstcPayload(toAmount: string) {
  return {
    toAmount,
    toAddress: 'terra1recipient',
    // Unset oneof — real protobuf payloads always carry the wrapper.
    signData: { case: undefined },
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
    toAddress: 'terra1recipient',
    signData: { case: undefined },
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

describe('getCosmosChainSpecific — USTC denom-aware gas and burn tax', () => {
  beforeEach(() => {
    vi.mocked(getTerraClassicBurnTaxRate).mockReset()
    vi.mocked(getTerraClassicBurnTaxRate).mockResolvedValue(0n)
    vi.mocked(getCosmosFeeAmount).mockClear()
    vi.mocked(getCosmosFeeAmount).mockResolvedValue(7500n)
  })

  it('preserves a uint64 sequence above the JavaScript safe-integer limit', async () => {
    const sequence = 9_007_199_254_740_993n
    vi.mocked(getCosmosAccountInfo).mockResolvedValueOnce({
      address: 'terra1abc',
      pubkey: null,
      accountNumber: 42n,
      sequence: Number(sequence),
      sequenceBigInt: sequence,
      latestBlock: '1234567_0',
    })

    const result = await getCosmosChainSpecific({
      keysignPayload: makeLuncPayload('1'),
      transactionType: 0 as any,
      walletCore: mockWalletCore,
    })

    expect(result.sequence).toBe(sequence)
  })

  it('prices USTC gas in uusd when the burn-tax rate is zero', async () => {
    const result = await getCosmosChainSpecific({
      keysignPayload: makeUstcPayload('10000000'),
      transactionType: 0 as any,
      walletCore: mockWalletCore,
    })

    expect(result.gas).toBe(225_000n)
    expect(result.ibcDenomTraces?.baseDenom).toBe('')
    expect(getCosmosFeeAmount).not.toHaveBeenCalled()
  })

  it('folds the current burn tax into the single USTC fee amount', async () => {
    // 1.2% rate on 10_000_000 uusd = 120_000 uusd, plus 225_000 uusd gas.
    vi.mocked(getTerraClassicBurnTaxRate).mockResolvedValue(12_000_000_000_000_000n)

    const result = await getCosmosChainSpecific({
      keysignPayload: makeUstcPayload('10000000'),
      transactionType: 0 as any,
      walletCore: mockWalletCore,
    })

    expect(result.gas).toBe(345_000n)
    expect(result.ibcDenomTraces?.baseDenom).toBe('')
  })

  it('keeps native LUNC on the uluna base-fee path', async () => {
    const result = await getCosmosChainSpecific({
      keysignPayload: makeLuncPayload('10000000'),
      transactionType: 0 as any,
      walletCore: mockWalletCore,
    })

    expect(result.gas).toBe(7500n)
    expect(result.ibcDenomTraces?.baseDenom).toBe('')
  })
})
