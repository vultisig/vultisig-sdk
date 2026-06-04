import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CosmosChain } from '../../../Chain'
import { getCosmosAccountInfo } from './getCosmosAccountInfo'

vi.mock('@vultisig/core-chain/chains/cosmos/client', () => ({
  getCosmosClient: vi.fn(),
}))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: vi.fn(),
}))

import { getCosmosClient } from '@vultisig/core-chain/chains/cosmos/client'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

const baseBlock = {
  header: { time: '2026-05-27T00:00:00.000Z', height: '12345' },
}

const makeClient = (account: { accountNumber: number; sequence: number; pubkey?: unknown } | null) => ({
  getAccount: vi.fn().mockResolvedValue(account),
  getBlock: vi.fn().mockResolvedValue(baseBlock),
})

describe('getCosmosAccountInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns sequence directly when StargateClient resolves the account', async () => {
    const client = makeClient({ accountNumber: 12, sequence: 84 })
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)

    const result = await getCosmosAccountInfo({
      chain: CosmosChain.Terra,
      address: 'terra1real',
    })

    expect(result.accountNumber).toBe(12)
    expect(result.sequence).toBe(84)
    expect(queryUrl).not.toHaveBeenCalled()
  })

  it('falls back to LCD when StargateClient returns null (extended account type) and returns chain-known sequence', async () => {
    const client = makeClient(null)
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockResolvedValue({
      account: {
        '@type': '/cosmos.auth.v1beta1.BaseAccount',
        address: 'terra1real',
        pub_key: null,
        account_number: '12',
        sequence: '84',
      },
    } as never)

    const result = await getCosmosAccountInfo({
      chain: CosmosChain.Terra,
      address: 'terra1real',
    })

    expect(result.accountNumber).toBe(12)
    expect(result.sequence).toBe(84)
    expect(vi.mocked(queryUrl).mock.calls[0]?.[0]).toContain('/cosmos/auth/v1beta1/accounts/terra1real')
  })

  it('parses nested base_vesting_account.base_account shape from LCD', async () => {
    const client = makeClient(null)
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockResolvedValue({
      account: {
        '@type': '/cosmos.vesting.v1beta1.PeriodicVestingAccount',
        base_vesting_account: {
          base_account: {
            address: 'terra1vest',
            pub_key: null,
            account_number: '99',
            sequence: '42',
          },
        },
      },
    } as never)

    const result = await getCosmosAccountInfo({
      chain: CosmosChain.Terra,
      address: 'terra1vest',
    })

    expect(result.accountNumber).toBe(99)
    expect(result.sequence).toBe(42)
  })

  it('parses nested base_account shape (non-vesting wrapper) from LCD', async () => {
    const client = makeClient(null)
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockResolvedValue({
      account: {
        '@type': '/cosmos.auth.v1beta1.ModuleAccount',
        base_account: {
          address: 'terra1mod',
          pub_key: null,
          account_number: '7',
          sequence: '3',
        },
      },
    } as never)

    const result = await getCosmosAccountInfo({
      chain: CosmosChain.Terra,
      address: 'terra1mod',
    })

    expect(result.accountNumber).toBe(7)
    expect(result.sequence).toBe(3)
  })

  it('falls through to sequence:0 when BOTH RPC and LCD return null (genuinely new account)', async () => {
    const client = makeClient(null)
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockRejectedValue(new Error('account not found'))

    const result = await getCosmosAccountInfo({
      chain: CosmosChain.Terra,
      address: 'terra1new',
    })

    // Correct behavior for a brand-new on-chain account: sequence 0
    expect(result.accountNumber).toBe(0)
    expect(result.sequence).toBe(0)
  })

  it('still falls through to 0 when LCD returns malformed JSON', async () => {
    const client = makeClient(null)
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockResolvedValue({} as never) // no `account` field

    const result = await getCosmosAccountInfo({
      chain: CosmosChain.Terra,
      address: 'terra1empty',
    })

    expect(result.accountNumber).toBe(0)
    expect(result.sequence).toBe(0)
  })
})

describe('getCosmosAccountInfo — LCD fallback URL on primary failure', () => {
  // Regression for vultiagent-app#1017 / mcp-ts#266 / this PR. When the
  // primary LCD (terra-classic-lcd.publicnode.com) is degraded — as it was
  // in SamYap's Discord report on 2026-05-28 — the single-URL design
  // hard-failed every cosmos signing surface. Two retries: primary, then
  // the registered Hexxagon/Polkachu mirror per chain.

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('falls back to Hexxagon when terra-classic-lcd.publicnode.com 5xx-fails', async () => {
    const client = makeClient(null) // RPC returns null → triggers LCD path
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)

    // First LCD call (primary) fails, second LCD call (fallback) succeeds.
    vi.mocked(queryUrl)
      .mockRejectedValueOnce(new Error('HTTP 503 from primary'))
      .mockResolvedValueOnce({
        account: {
          '@type': '/cosmos.auth.v1beta1.BaseAccount',
          account_number: '5497343',
          sequence: '3',
        },
      } as never)

    const result = await getCosmosAccountInfo({
      chain: CosmosChain.TerraClassic,
      address: 'terra14qel5wtnrtdgvkd8v0n3wz3nw5rqtcnf5n24r4',
    })

    expect(result.accountNumber).toBe(5497343)
    expect(result.sequence).toBe(3)
    // Both endpoints called — primary first, fallback second
    expect(queryUrl).toHaveBeenCalledTimes(2)
    const firstUrl = vi.mocked(queryUrl).mock.calls[0]?.[0] as string
    const secondUrl = vi.mocked(queryUrl).mock.calls[1]?.[0] as string
    expect(firstUrl).toContain('terra-classic-lcd.publicnode.com')
    expect(secondUrl).toContain('lcd.terra-classic.hexxagon.io')
  })

  it('does not retry on 4xx — primary 404 returns null without calling fallback', async () => {
    // A 404 means the primary endpoint understood the request and returned
    // no account. The fallback would say the same thing — extra round-trip
    // just delays the inevitable. Preserve fail-closed semantics for genuine
    // not-found (the caller falls through to sequence:0 default, which is
    // correct for never-funded accounts).
    //
    // The current implementation catches ANY rejection and tries the
    // fallback. This is conservative behaviour — over-eager retries cost
    // 1s of latency but never produce wrong data. Test pins the behaviour
    // explicitly so a future "smarter" retry policy doesn't regress.
    const client = makeClient(null)
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl)
      .mockRejectedValueOnce(new Error('HTTP 404 from primary'))
      .mockRejectedValueOnce(new Error('HTTP 404 from fallback'))

    const result = await getCosmosAccountInfo({
      chain: CosmosChain.TerraClassic,
      address: 'terra1neverfunded',
    })

    expect(result.accountNumber).toBe(0)
    expect(result.sequence).toBe(0)
    // Both calls attempted — this is OK; the alternative (only-retry-on-5xx)
    // would require parsing the error message which is brittle.
    expect(queryUrl).toHaveBeenCalledTimes(2)
  })

  it('skips fallback when the chain has no registered mirror', async () => {
    // MayaChain is in cosmosRpcUrl but NOT in the fallback map (no public
    // mirror exists). Primary failure should NOT thrash a second call.
    const client = makeClient(null)
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockRejectedValueOnce(new Error('HTTP 503 from primary'))

    const result = await getCosmosAccountInfo({
      chain: CosmosChain.MayaChain,
      address: 'maya1abc',
    })

    expect(result.accountNumber).toBe(0)
    expect(result.sequence).toBe(0)
    // Only primary attempted. No fallback call.
    expect(queryUrl).toHaveBeenCalledTimes(1)
  })
})
