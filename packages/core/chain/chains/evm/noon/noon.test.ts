import { describe, expect, it, vi } from 'vitest'

import {
  encodeNoonDeposit,
  encodeNoonRequestRedeem,
  encodeNoonUsdcApprove,
  encodeNoonWithdraw,
  fetchNoonUsdcVaultApy,
  fetchNoonUsdcVaultMetrics,
  getNoonDepositContractCall,
  getNoonDepositTxPlan,
  getNoonRequestRedeemContractCall,
  noonUsdcVaultConfig,
} from '.'

const sampleUser = '0x8b937c5395d95a8c8948c7c5b844e1541798d90c'

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

describe('Noon USDC vault calldata', () => {
  it('matches the reference deposit transaction input', () => {
    expect(encodeNoonDeposit(100_000_000n, sampleUser)).toBe(
      '0x6e553f650000000000000000000000000000000000000000000000000000000005f5e1000000000000000000000000008b937c5395d95a8c8948c7c5b844e1541798d90c'
    )
  })

  it('matches the reference requestRedeem transaction input', () => {
    const owner = '0xecfe16242e796c853aa0132c06651626d54ee1e6'

    expect(encodeNoonRequestRedeem(98_333_202n, owner, owner)).toBe(
      '0x7d41c86e0000000000000000000000000000000000000000000000000000000005dc7212000000000000000000000000ecfe16242e796c853aa0132c06651626d54ee1e6000000000000000000000000ecfe16242e796c853aa0132c06651626d54ee1e6'
    )
  })

  it('matches the reference withdraw/claim transaction input', () => {
    expect(encodeNoonWithdraw(97_617_839n, sampleUser, sampleUser)).toBe(
      '0xb460af940000000000000000000000000000000000000000000000000000000005d187af0000000000000000000000008b937c5395d95a8c8948c7c5b844e1541798d90c0000000000000000000000008b937c5395d95a8c8948c7c5b844e1541798d90c'
    )
  })

  it('targets USDC approval to the actual vault/share contract', () => {
    expect(encodeNoonUsdcApprove(100_000_000n)).toBe(
      '0x095ea7b3000000000000000000000000a73424f1ac94b3ef0d0c9af4f2967c87d4af25d90000000000000000000000000000000000000000000000000000000005f5e100'
    )
  })
})

describe('Noon USDC vault transaction planning', () => {
  it('rejects deposit calls below the product minimum', () => {
    expect(() => getNoonDepositContractCall(100_000n, sampleUser)).toThrow(
      'Noon deposit assets must be at least 100000000'
    )
  })

  it('rejects redeem requests below the product minimum', () => {
    expect(() => getNoonRequestRedeemContractCall(100_000n, sampleUser)).toThrow(
      'Noon redeem shares must be at least 95000000'
    )
  })

  it('includes an approval when USDC allowance is below the deposit amount', async () => {
    const client = {
      readContract: vi.fn().mockResolvedValue(50_000_000n),
    }

    const plan = await getNoonDepositTxPlan({
      owner: sampleUser,
      assets: 100_000_000n,
      client: client as never,
    })

    expect(plan.currentAllowance).toBe(50_000_000n)
    expect(plan.approval).toMatchObject({
      contractAddress: noonUsdcVaultConfig.assetAddress,
      functionName: 'approve',
      args: [noonUsdcVaultConfig.vaultAddress, 100_000_000n],
    })
    expect(plan.deposit).toMatchObject({
      contractAddress: noonUsdcVaultConfig.vaultAddress,
      functionName: 'deposit',
      args: [100_000_000n, sampleUser],
    })
  })

  it('omits approval when allowance already covers the deposit', async () => {
    const client = {
      readContract: vi.fn().mockResolvedValue(100_000_000n),
    }

    const plan = await getNoonDepositTxPlan({
      owner: sampleUser,
      assets: 100_000_000n,
      client: client as never,
    })

    expect(plan.approval).toBeUndefined()
  })
})

describe('Noon API parsing', () => {
  it('reads 7d net APY for the configured loan address from the current API shape', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        vaults: [
          {
            loan_address: noonUsdcVaultConfig.loanAddress,
            ir: {
              '7d': { net: { apy_pct: '11.5512' } },
            },
          },
        ],
      })
    )

    await expect(fetchNoonUsdcVaultApy(fetchImpl)).resolves.toBe(11.5512)
  })

  it('keeps reading 7d net APY from the legacy API shape', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        vaults: [
          {
            loan_address: noonUsdcVaultConfig.loanAddress,
            '7d': { net: { apy_pct: '11.5512' } },
          },
        ],
      })
    )

    await expect(fetchNoonUsdcVaultApy(fetchImpl)).resolves.toBe(11.5512)
  })

  it('falls back to legacy APY data when current-shape data is absent', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        vaults: [
          {
            loan_address: noonUsdcVaultConfig.loanAddress,
            ir: {},
            '7d': { net: { apy_pct: '10.25' } },
          },
        ],
      })
    )

    await expect(fetchNoonUsdcVaultApy(fetchImpl)).resolves.toBe(10.25)
  })

  it('falls back to legacy APY data when current-shape data is not an object', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        vaults: [
          {
            loan_address: noonUsdcVaultConfig.loanAddress,
            ir: null,
            '7d': { net: { apy_pct: '9.75' } },
          },
        ],
      })
    )

    await expect(fetchNoonUsdcVaultApy(fetchImpl)).resolves.toBe(9.75)
  })

  it('combines APY and Accountable TVL metrics', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('back.noon.capital')) {
        return jsonResponse({
          vaults: [
            {
              loan_address: noonUsdcVaultConfig.loanAddress,
              ir: {
                '7d': { net: { apy_pct: '11.5512' } },
              },
            },
          ],
        })
      }

      return jsonResponse({
        loan_computed: {
          tvl: 151_818_466_031,
          tvl_in_usd: 150_955.74767223233,
        },
      })
    })

    await expect(fetchNoonUsdcVaultMetrics(fetchImpl)).resolves.toEqual({
      apy7dNetPercent: 11.5512,
      tvl: 151_818_466_031,
      tvlInUsd: 150_955.74767223233,
    })
  })
})
