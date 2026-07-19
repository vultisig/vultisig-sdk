import { HttpResponseError } from '@vultisig/lib-utils/fetch/HttpResponseError'
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

const httpError = (status: number) =>
  new HttpResponseError({
    message: `HTTP ${status}`,
    status,
    statusText: status === 404 ? 'Not Found' : 'Error',
    url: 'https://lcd.example.test/cosmos/auth/v1beta1/accounts/test',
    body: {},
  })

// cosmjs/stargate 0.39 widened Account.accountNumber to `bigint`; sequence
// stays `number`. Mock signature mirrors the real shape so test fixtures
// catch a future cosmjs bump that widens sequence too.
const makeClient = (account: { accountNumber: bigint; sequence: number; pubkey?: unknown } | null) => ({
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
    const client = makeClient({ accountNumber: 12n, sequence: 84 })
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)

    const result = await getCosmosAccountInfo({
      chain: CosmosChain.Terra,
      address: 'terra1real',
    })

    expect(result.accountNumber).toBe(12n)
    expect(result.sequence).toBe(84)
    expect(result.sequenceBigInt).toBe(84n)
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

    expect(result.accountNumber).toBe(12n)
    expect(result.sequence).toBe(84)
    expect(result.sequenceBigInt).toBe(84n)
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

    expect(result.accountNumber).toBe(99n)
    expect(result.sequence).toBe(42)
    expect(result.sequenceBigInt).toBe(42n)
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

    expect(result.accountNumber).toBe(7n)
    expect(result.sequence).toBe(3)
    expect(result.sequenceBigInt).toBe(3n)
  })

  it('falls through to sequence:0 when BOTH RPC and LCD return null (genuinely new account)', async () => {
    const client = makeClient(null)
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockRejectedValue(httpError(404))

    const result = await getCosmosAccountInfo({
      chain: CosmosChain.Terra,
      address: 'terra1new',
    })

    // Correct behavior for a brand-new on-chain account: sequence 0
    expect(result.accountNumber).toBe(0n)
    expect(result.sequence).toBe(0)
    expect(result.sequenceBigInt).toBe(0n)
  })

  it('rejects an HTTP-success LCD response without an account envelope', async () => {
    const client = makeClient(null)
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockResolvedValue({} as never) // no `account` field

    await expect(
      getCosmosAccountInfo({
        chain: CosmosChain.Terra,
        address: 'terra1empty',
      })
    ).rejects.toThrow('Invalid Cosmos account data: missing account')
  })

  it('rejects a blank account envelope instead of treating it as sequence zero', async () => {
    const client = makeClient(null)
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockResolvedValue({ account: {} } as never)

    await expect(
      getCosmosAccountInfo({
        chain: CosmosChain.Terra,
        address: 'terra1blank',
      })
    ).rejects.toThrow('Invalid Cosmos account data: missing address')
  })

  it('rejects an unsupported direct account wrapper', async () => {
    const client = makeClient(null)
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockResolvedValue({
      account: {
        '@type': '/example.unsupported.v1.Account',
        address: 'terra1unsupported',
      },
    } as never)

    await expect(
      getCosmosAccountInfo({
        chain: CosmosChain.Terra,
        address: 'terra1unsupported',
      })
    ).rejects.toThrow('Invalid Cosmos account data: unsupported account type')
  })

  it('rejects an LCD account whose address does not match the requested account', async () => {
    const client = makeClient(null)
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockResolvedValue({
      account: {
        '@type': '/cosmos.auth.v1beta1.BaseAccount',
        address: 'terra1different',
      },
    } as never)

    await expect(
      getCosmosAccountInfo({
        chain: CosmosChain.Terra,
        address: 'terra1requested',
      })
    ).rejects.toThrow('Invalid Cosmos account data: address mismatch')
  })

  it('treats an omitted ProtoJSON sequence as zero once the account envelope is present', async () => {
    const client = makeClient(null)
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockResolvedValue({
      account: { address: 'terra1zero-sequence', account_number: '12' },
    } as never)

    const result = await getCosmosAccountInfo({
      chain: CosmosChain.Terra,
      address: 'terra1zero-sequence',
    })

    expect(result.accountNumber).toBe(12n)
    expect(result.sequence).toBe(0)
    expect(result.sequenceBigInt).toBe(0n)
  })

  it('treats an omitted ProtoJSON account number as zero once the account envelope is present', async () => {
    const client = makeClient(null)
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockResolvedValue({
      account: { address: 'terra1zero-account-number', sequence: '12' },
    } as never)

    const result = await getCosmosAccountInfo({
      chain: CosmosChain.Terra,
      address: 'terra1zero-account-number',
    })

    expect(result.accountNumber).toBe(0n)
    expect(result.sequence).toBe(12)
    expect(result.sequenceBigInt).toBe(12n)
  })

  it('preserves an LCD sequence above Number.MAX_SAFE_INTEGER exactly', async () => {
    const client = makeClient(null)
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockResolvedValue({
      account: {
        address: 'terra1large',
        account_number: '12',
        sequence: '9007199254740993',
      },
    } as never)

    const result = await getCosmosAccountInfo({
      chain: CosmosChain.Terra,
      address: 'terra1large',
    })

    expect(result.sequence).toBe(9007199254740992)
    expect(result.sequenceBigInt).toBe(9007199254740993n)
  })

  it('re-queries an unsafe RPC sequence through LCD to recover its exact uint64 value', async () => {
    const client = makeClient({ accountNumber: 12n, sequence: 9007199254740992 })
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockResolvedValue({
      account: {
        address: 'terra1large',
        account_number: '12',
        sequence: '9007199254740993',
      },
    } as never)

    const result = await getCosmosAccountInfo({
      chain: CosmosChain.Terra,
      address: 'terra1large',
    })

    expect(result.sequenceBigInt).toBe(9007199254740993n)
  })

  it('recovers an exact LCD sequence when Stargate rejects unsafe uint64 decoding', async () => {
    const decodeError = new RangeError('Number can only safely store up to 53 bits')
    const client = {
      getAccount: vi.fn().mockRejectedValue(decodeError),
      getBlock: vi.fn().mockResolvedValue(baseBlock),
    }
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockResolvedValue({
      account: {
        address: 'terra1large',
        account_number: '12',
        sequence: '9007199254740993',
      },
    } as never)

    const result = await getCosmosAccountInfo({
      chain: CosmosChain.Terra,
      address: 'terra1large',
    })

    expect(result.accountNumber).toBe(12n)
    expect(result.sequenceBigInt).toBe(9007199254740993n)
  })

  it('preserves the Stargate decode error when exact LCD recovery fails', async () => {
    const decodeError = new RangeError('Number can only safely store up to 53 bits')
    const client = {
      getAccount: vi.fn().mockRejectedValue(decodeError),
      getBlock: vi.fn().mockResolvedValue(baseBlock),
    }
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockRejectedValue(new Error('LCD unavailable'))

    await expect(
      getCosmosAccountInfo({
        chain: CosmosChain.Terra,
        address: 'terra1large',
      })
    ).rejects.toBe(decodeError)
  })

  it('preserves the Stargate decode error when LCD account data is malformed', async () => {
    const decodeError = new RangeError('Number can only safely store up to 53 bits')
    const client = {
      getAccount: vi.fn().mockRejectedValue(decodeError),
      getBlock: vi.fn().mockResolvedValue(baseBlock),
    }
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockResolvedValue({
      account: { address: 'terra1large', account_number: '12', sequence: -1 },
    } as never)

    await expect(
      getCosmosAccountInfo({
        chain: CosmosChain.Terra,
        address: 'terra1large',
      })
    ).rejects.toBe(decodeError)
  })

  it('rejects an unsafe RPC sequence when no exact LCD value is available', async () => {
    const client = makeClient({ accountNumber: 12n, sequence: 9007199254740992 })
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockRejectedValue(new Error('LCD unavailable'))

    await expect(
      getCosmosAccountInfo({
        chain: CosmosChain.Terra,
        address: 'terra1large',
      })
    ).rejects.toThrow('Cosmos account sequence cannot be represented exactly')
  })

  it.each(['-1', '1.5', '18446744073709551616'])(
    'rejects an invalid LCD uint64 sequence before signing fallback (%s)',
    async sequence => {
      const client = makeClient(null)
      vi.mocked(getCosmosClient).mockResolvedValue(client as never)
      vi.mocked(queryUrl).mockResolvedValue({
        account: {
          address: 'terra1invalid',
          account_number: '12',
          sequence,
        },
      } as never)

      await expect(
        getCosmosAccountInfo({
          chain: CosmosChain.Terra,
          address: 'terra1invalid',
        })
      ).rejects.toThrow('Invalid Cosmos account sequence')
      expect(queryUrl).toHaveBeenCalledTimes(1)
    }
  )

  it.each(['-1', '1.5', '18446744073709551616'])(
    'rejects an invalid LCD uint64 account number before signing fallback (%s)',
    async accountNumber => {
      const client = makeClient(null)
      vi.mocked(getCosmosClient).mockResolvedValue(client as never)
      vi.mocked(queryUrl).mockResolvedValue({
        account: {
          address: 'terra1invalid',
          account_number: accountNumber,
          sequence: '12',
        },
      } as never)

      await expect(
        getCosmosAccountInfo({
          chain: CosmosChain.Terra,
          address: 'terra1invalid',
        })
      ).rejects.toThrow('Invalid Cosmos account account_number')
      expect(queryUrl).toHaveBeenCalledTimes(1)
    }
  )
})

describe('getCosmosAccountInfo — LCD fallback URL on primary failure', () => {
  // Regression for vultiagent-app#1017 / mcp-ts#266 / this PR. When the
  // primary LCD (terra-classic-lcd.publicnode.com) is degraded — as it was
  // in SamYap's Discord report on 2026-05-28 — the single-URL design
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
          address: 'terra14qel5wtnrtdgvkd8v0n3wz3nw5rqtcnf5n24r4',
          account_number: '5497343',
          sequence: '3',
        },
      } as never)

    const result = await getCosmosAccountInfo({
      chain: CosmosChain.TerraClassic,
      address: 'terra14qel5wtnrtdgvkd8v0n3wz3nw5rqtcnf5n24r4',
    })

    expect(result.accountNumber).toBe(5497343n)
    expect(result.sequence).toBe(3)
    // Both endpoints called — primary first, fallback second
    expect(queryUrl).toHaveBeenCalledTimes(2)
    const firstUrl = vi.mocked(queryUrl).mock.calls[0]?.[0] as string
    const secondUrl = vi.mocked(queryUrl).mock.calls[1]?.[0] as string
    expect(firstUrl).toContain('terra-classic-lcd.publicnode.com')
    expect(secondUrl).toContain('lcd.terra-classic.hexxagon.io')
  })

  it('does not retry a structured 404 because it authoritatively means account not found', async () => {
    // A 404 means the primary endpoint understood the request and returned
    // no account. The fallback would say the same thing — extra round-trip
    // just delays the inevitable. Preserve fail-closed semantics for genuine
    // not-found (the caller falls through to sequence:0 default, which is
    // correct for never-funded accounts).
    //
    const client = makeClient(null)
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockRejectedValueOnce(httpError(404))

    const result = await getCosmosAccountInfo({
      chain: CosmosChain.TerraClassic,
      address: 'terra1neverfunded',
    })

    expect(result.accountNumber).toBe(0n)
    expect(result.sequence).toBe(0)
    expect(queryUrl).toHaveBeenCalledTimes(1)
  })

  it('fails closed on an unavailable LCD when the chain has no registered mirror', async () => {
    // MayaChain is in cosmosRpcUrl but NOT in the fallback map (no public
    // mirror exists). Primary failure should NOT thrash a second call.
    const client = makeClient(null)
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl).mockRejectedValueOnce(new Error('HTTP 503 from primary'))

    await expect(
      getCosmosAccountInfo({
        chain: CosmosChain.MayaChain,
        address: 'maya1abc',
      })
    ).rejects.toThrow('HTTP 503 from primary')
    // Only primary attempted. No fallback call.
    expect(queryUrl).toHaveBeenCalledTimes(1)
  })

  it('fails closed when both primary and fallback LCD endpoints are unavailable', async () => {
    const client = makeClient(null)
    vi.mocked(getCosmosClient).mockResolvedValue(client as never)
    vi.mocked(queryUrl)
      .mockRejectedValueOnce(new Error('primary unavailable'))
      .mockRejectedValueOnce(new Error('fallback unavailable'))

    await expect(
      getCosmosAccountInfo({
        chain: CosmosChain.TerraClassic,
        address: 'terra1existing',
      })
    ).rejects.toThrow('fallback unavailable')
    expect(queryUrl).toHaveBeenCalledTimes(2)
  })
})
