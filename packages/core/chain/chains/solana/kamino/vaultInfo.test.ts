import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  fetchKaminoVaultState: vi.fn(),
  fetchKaminoVaultMetrics: vi.fn(),
}))

import { kaminoAmountApiString } from './amount'
import { fetchKaminoVaultMetrics, fetchKaminoVaultState } from './api'
import { KaminoServiceError } from './KaminoServiceError'
import { kaminoVaultRegistry } from './registry'
import { fetchKaminoVaultInfo } from './vaultInfo'

const [steakhouseUsdc, , allezSol] = kaminoVaultRegistry

const stateFor = (vault: typeof steakhouseUsdc, overrides: Record<string, unknown> = {}) => ({
  address: vault.address,
  programId: 'KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd',
  state: {
    name: vault.fallbackName,
    tokenMint: vault.tokenMint,
    tokenMintDecimals: vault.tokenDecimals,
    sharesMint: vault.sharesMint,
    sharesMintDecimals: vault.sharesDecimals,
    minDepositAmount: '100000',
    minWithdrawAmount: '1000',
    vaultLookupTable: 'D9pGqvkAaPJXjrbngmL3xeFbxNWDn1DrMYnV9vWKgHrE',
    vaultFarm: vault.farm ?? '11111111111111111111111111111111',
    performanceFeeBps: 1000,
    managementFeeBps: 0,
    ...overrides,
  },
})

const metrics = (overrides: Record<string, string> = {}) => ({
  apy30d: '0.0391',
  tokensPerShare: '1.0536041812651029025',
  sharePrice: '1.0541',
  tokenPrice: '0.9998',
  tokensAvailable: '9581.812345',
  tokensInvested: '2650000.12',
  ...overrides,
})

const mockApi = (state: unknown, metricsResponse: unknown) => {
  vi.mocked(fetchKaminoVaultState).mockResolvedValue(state as never)
  vi.mocked(fetchKaminoVaultMetrics).mockResolvedValue(metricsResponse as never)
}

beforeEach(() => {
  vi.mocked(fetchKaminoVaultState).mockReset()
  vi.mocked(fetchKaminoVaultMetrics).mockReset()
})

describe('fetchKaminoVaultInfo', () => {
  it('refuses an address the registry does not carry', async () => {
    await expect(fetchKaminoVaultInfo('So11111111111111111111111111111111111111112')).rejects.toMatchObject({
      reason: { vaultNotInRegistry: 'So11111111111111111111111111111111111111112' },
    })
    expect(vi.mocked(fetchKaminoVaultState)).not.toHaveBeenCalled()
  })

  it('hydrates a curated vault from live state and metrics', async () => {
    mockApi(stateFor(steakhouseUsdc), metrics())

    const info = await fetchKaminoVaultInfo(steakhouseUsdc.address)

    expect(info.descriptor).toBe(steakhouseUsdc)
    expect(info.name).toBe('Steakhouse USDC')
    expect(info.apy30d).toBe(0.0391)
    expect(info.tokenPriceUsd).toBe(0.9998)
    expect(info.tokensPerShare).toEqual({ numerator: 10536041812651029025n, scale: 19 })
    expect(info.tokensAvailable && kaminoAmountApiString(info.tokensAvailable)).toBe('9581.812345')
  })

  it('offers a deposit minimum the program actually accepts, not the published one', async () => {
    mockApi(stateFor(steakhouseUsdc), metrics())

    const info = await fetchKaminoVaultInfo(steakhouseUsdc.address)

    // Proportional margin: 100000 + max(ceil(100000/1000), 16) = 100100.
    expect(info.minDeposit.baseUnits).toBe(100_100n)
  })

  it('applies the absolute margin floor to a small published minimum', async () => {
    mockApi(stateFor(steakhouseUsdc, { minDepositAmount: '1000' }), metrics())

    const info = await fetchKaminoVaultInfo(steakhouseUsdc.address)

    // ceil(1000/1000) = 1 would not clear a rounding loss; the floor is 16.
    expect(info.minDeposit.baseUnits).toBe(1_016n)
  })

  it('derives the withdraw minimum in shares from the token-denominated field', async () => {
    mockApi(stateFor(steakhouseUsdc), metrics())

    const info = await fetchKaminoVaultInfo(steakhouseUsdc.address)

    // The program's floor sits above the published figure, so the form minimum
    // is a multiple of it, converted to shares and rounded up:
    // ceil(3000 token base units / 1.0536041812651029025) = 2848 share units.
    expect(info.minWithdraw.unit).toBe('kaminoShare')
    expect(info.minWithdraw.baseUnits).toBe(2_848n)
  })

  it('scales the withdraw minimum with the vault whose share and token decimals differ', async () => {
    mockApi(
      stateFor(allezSol, { minDepositAmount: '10000000', minWithdrawAmount: '1000' }),
      metrics({ tokensPerShare: '0.0010749299151180878396' })
    )

    const info = await fetchKaminoVaultInfo(allezSol.address)

    // 3000 lamports (9 decimals) ÷ rate → share base units at 6 decimals:
    // ceil(0.000003 / 0.0010749299151180878396 × 10^6) = 2791.
    expect(info.minWithdraw.baseUnits).toBe(2_791n)
  })

  it('refuses a response that disagrees with the pinned vault identity', async () => {
    mockApi(stateFor(steakhouseUsdc, { tokenMint: allezSol.tokenMint }), metrics())

    await expect(fetchKaminoVaultInfo(steakhouseUsdc.address)).rejects.toMatchObject({
      reason: {
        vaultMetadataMismatch: {
          field: 'tokenMint',
          expected: steakhouseUsdc.tokenMint,
          actual: allezSol.tokenMint,
        },
      },
    })
  })

  it('refuses mismatched decimals — a wrong scale mis-sizes by a power of ten', async () => {
    mockApi(stateFor(steakhouseUsdc, { sharesMintDecimals: 9 }), metrics())

    await expect(fetchKaminoVaultInfo(steakhouseUsdc.address)).rejects.toBeInstanceOf(KaminoServiceError)
  })

  it('refuses a farm the registry does not pin', async () => {
    mockApi(stateFor(steakhouseUsdc, { vaultFarm: allezSol.farm }), metrics())

    await expect(fetchKaminoVaultInfo(steakhouseUsdc.address)).rejects.toMatchObject({
      reason: { vaultMetadataMismatch: { field: 'vaultFarm' } },
    })
  })

  it('throws on a malformed published minimum instead of defaulting to zero', async () => {
    mockApi(stateFor(steakhouseUsdc, { minDepositAmount: 'n/a' }), metrics())

    await expect(fetchKaminoVaultInfo(steakhouseUsdc.address)).rejects.toMatchObject({
      reason: { malformedNumber: { field: 'minDepositAmount', value: 'n/a' } },
    })
  })

  it('throws on a non-positive share rate — it would size withdraws', async () => {
    mockApi(stateFor(steakhouseUsdc), metrics({ tokensPerShare: '0' }))

    await expect(fetchKaminoVaultInfo(steakhouseUsdc.address)).rejects.toMatchObject({
      reason: { malformedNumber: { field: 'tokensPerShare' } },
    })
  })

  it('throws on a malformed display metric rather than coercing it', async () => {
    mockApi(stateFor(steakhouseUsdc), metrics({ apy30d: '3.91%' }))

    await expect(fetchKaminoVaultInfo(steakhouseUsdc.address)).rejects.toMatchObject({
      reason: { malformedNumber: { field: 'apy30d' } },
    })
  })

  it('drops an unreadable liquidity figure instead of failing the hydration', async () => {
    mockApi(stateFor(steakhouseUsdc), metrics({ tokensAvailable: 'unknown' }))

    const info = await fetchKaminoVaultInfo(steakhouseUsdc.address)

    expect(info.tokensAvailable).toBeUndefined()
  })
})
