import { afterEach, describe, expect, it, vi } from 'vitest'

import type { YieldActionResponse, YieldDiscoverOpportunity, YieldTransaction } from '@/tools/defi/stakekit'
import {
  buildYieldActionScanRequest,
  buildYieldActionScanRequests,
  buildYieldStepScanRequest,
  parseActionDisplay,
  stakekitBalances,
  stakekitBuildEnter,
  stakekitBuildExit,
  stakekitDetails,
  stakekitSearch,
  validateStakekitActionAddress,
  validateStakekitActionInput,
  yieldNetworkToCanonicalChain,
} from '@/tools/defi/stakekit'

// Minimal yield product fixture that matches YieldDiscoverOpportunity shape
const makeProduct = (overrides: Record<string, unknown> = {}) => ({
  id: 'ethereum-eth-lido-staking',
  token: {
    symbol: 'ETH',
    name: 'Ethereum',
    network: 'ethereum',
    decimals: 18,
  },
  tokens: [
    {
      symbol: 'ETH',
      name: 'Ethereum',
      network: 'ethereum',
      decimals: 18,
    },
  ],
  // apy is a FRACTION (0..1), e.g. 0.0421 = 4.21%
  apy: 0.0421,
  isAvailable: true,
  metadata: {
    name: 'Lido Staked ETH',
    type: 'liquid-staking',
    provider: {
      id: 'lido',
      name: 'Lido',
      logoURI: 'https://example.com/lido.png',
    },
    cooldownPeriod: undefined,
  },
  args: { enter: { addresses: {}, args: {} }, exit: { addresses: {}, args: {} } },
  validators: [],
  status: { enter: true, exit: true },
  ...overrides,
})

// Minimal YieldActionResponse fixture for EVM (base network)
const makeEvmActionResponse = (overrides: Partial<YieldActionResponse> = {}): YieldActionResponse => ({
  id: 'action-1',
  intent: 'ENTER',
  type: 'STAKE',
  yieldId: 'base-usdc-aave-v3-lending',
  amount: '100',
  amountRaw: '100000000',
  amountUsd: '100',
  transactions: [
    {
      id: 'tx-1',
      title: 'Approve USDC',
      type: 'APPROVAL',
      network: 'base',
      status: 'CREATED',
      unsignedTransaction: JSON.stringify({
        to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        value: '0x0',
        data: '0x095ea7b3000000000000000000000000abc',
        from: '0x1234567890123456789012345678901234567890',
      }),
      gasEstimate: JSON.stringify({ gasLimit: '100000' }),
    },
    {
      id: 'tx-2',
      title: 'Deposit USDC',
      type: 'SUPPLY',
      network: 'base',
      status: 'CREATED',
      unsignedTransaction: JSON.stringify({
        to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb0',
        value: '0x0',
        data: '0xe8eda9df000000000000000000000000abc',
        from: '0x1234567890123456789012345678901234567890',
        gasLimit: '200000',
        maxFeePerGas: '0x5f5e100',
      }),
      gasEstimate: '{}',
    },
  ],
  ...overrides,
})

// Minimal YieldActionResponse fixture for Solana
const makeSolanaActionResponse = (): YieldActionResponse => ({
  id: 'action-sol',
  intent: 'ENTER',
  type: 'STAKE',
  yieldId: 'solana-sol-marinade-staking',
  amount: '1',
  amountRaw: '1000000000',
  amountUsd: '100',
  transactions: [
    {
      id: 'tx-sol-1',
      title: 'Stake SOL',
      type: 'STAKE',
      network: 'solana',
      status: 'CREATED',
      unsignedTransaction:
        'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQABAQL',
      gasEstimate: '{}',
    },
  ],
})

describe('sdk.defi.stakekit', () => {
  // Save and restore fetch
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  describe('stakekitSearch', () => {
    it('normalizes public network aliases at the StakeKit request boundary', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [], hasNextPage: false }),
        text: async () => '',
      } as Response)
      globalThis.fetch = fetchMock

      await stakekitSearch({ network: 'BSC' })

      const requestUrl = String(fetchMock.mock.calls[0]?.[0])
      expect(new URL(requestUrl).searchParams.get('network')).toBe('binance')
    })

    it('returns rows with YieldDiscoverOpportunity-compatible shape: apy is fraction, provider nested in metadata, id present', async () => {
      const product = makeProduct()
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [product], hasNextPage: false }),
        text: async () => JSON.stringify({ data: [product], hasNextPage: false }),
      } as Response)

      const results = await stakekitSearch({ network: 'ethereum', limit: 5 })
      expect(results).toHaveLength(1)

      const r = results[0]
      expect(r.id).toBe('ethereum-eth-lido-staking')
      // apy MUST be a number (fraction 0..1), not a string or percent
      expect(typeof r.apy).toBe('number')
      expect(r.apy).toBe(0.0421) // fraction, not 4.21
      // provider is nested in metadata, not at root
      expect(r.metadata.provider?.name).toBe('Lido')
      expect((r as Record<string, unknown>).provider).toBeUndefined()
      // YieldDiscoverOpportunity shape
      const opp: YieldDiscoverOpportunity = r as unknown as YieldDiscoverOpportunity
      expect(opp.id).toBeTruthy()
      expect(opp.status.enter).toBe(true)
      expect(opp.isAvailable).toBe(true)
    })

    it('applies client-side token filter (stakek.it ignores token param server-side)', async () => {
      const eth = makeProduct({ id: 'ethereum-eth-lido-staking' })
      const usdc = makeProduct({
        id: 'ethereum-usdc-aave-v3-lending',
        token: { symbol: 'USDC', name: 'USD Coin', network: 'ethereum', decimals: 6 },
      })
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [eth, usdc], hasNextPage: false }),
        text: async () => '',
      } as Response)

      const results = await stakekitSearch({ token: 'USDC' })
      expect(results).toHaveLength(1)
      expect(results[0].token.symbol).toBe('USDC')
    })
  })

  // /yields/enabled returns ONLY the products a given project's API key may
  // deposit into. The cache key omitted the credential entirely, so the first
  // caller's allowed set was served to every other caller for the full 5-minute
  // TTL - leaking one project's enabled products to another AND hiding products
  // the second project actually has.
  //
  // The module-level cache persists across tests in this file, so each case
  // below uses a `type` value no other test uses, keeping it off shared entries.
  describe('enabled-yield cache is scoped per API key (sdk#1789)', () => {
    const okOnce = (products: unknown[]) =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ data: products, hasNextPage: false }),
        text: async () => '',
      }) as Response

    it("does not serve one API key's enabled set to a different key", async () => {
      const alpha = makeProduct({ id: 'ethereum-eth-lido-staking' })
      const beta = makeProduct({ id: 'ethereum-usdc-aave-v3-lending' })
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(okOnce([alpha]))
        .mockResolvedValueOnce(okOnce([beta]))
      globalThis.fetch = fetchMock

      const q = { network: 'ethereum', type: 'iso-two-keys' }
      const first = await stakekitSearch({ ...q, apiKey: 'project-key-AAA' })
      const second = await stakekitSearch({ ...q, apiKey: 'project-key-BBB' })

      // Identical query, different credential -> must actually be fetched again.
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(first[0].id).toBe('ethereum-eth-lido-staking')
      expect(second[0].id).toBe('ethereum-usdc-aave-v3-lending')
    })

    it('treats an unauthenticated call as its own scope, not a keyed one', async () => {
      const keyed = makeProduct({ id: 'ethereum-eth-lido-staking' })
      const anon = makeProduct({ id: 'ethereum-usdc-aave-v3-lending' })
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(okOnce([keyed]))
        .mockResolvedValueOnce(okOnce([anon]))
      globalThis.fetch = fetchMock

      const q = { network: 'ethereum', type: 'iso-anon' }
      const withKey = await stakekitSearch({ ...q, apiKey: 'project-key-AAA' })
      const withoutKey = await stakekitSearch(q)

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(withKey[0].id).toBe('ethereum-eth-lido-staking')
      expect(withoutKey[0].id).toBe('ethereum-usdc-aave-v3-lending')
    })

    // The other half: scoping must not defeat caching for the caller it belongs
    // to, or this trades a correctness bug for hammering the upstream.
    it('still caches when the same key repeats the same query', async () => {
      const product = makeProduct({ id: 'ethereum-eth-lido-staking' })
      const fetchMock = vi.fn().mockResolvedValue(okOnce([product]))
      globalThis.fetch = fetchMock

      const q = { network: 'ethereum', type: 'iso-same-key', apiKey: 'project-key-AAA' }
      await stakekitSearch(q)
      await stakekitSearch(q)

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    // Surrounding whitespace is not a different credential.
    it('does not split the cache on incidental whitespace around the key', async () => {
      const product = makeProduct({ id: 'ethereum-eth-lido-staking' })
      const fetchMock = vi.fn().mockResolvedValue(okOnce([product]))
      globalThis.fetch = fetchMock

      const q = { network: 'ethereum', type: 'iso-trim' }
      await stakekitSearch({ ...q, apiKey: 'project-key-AAA' })
      await stakekitSearch({ ...q, apiKey: '  project-key-AAA  ' })

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('parseActionDisplay', () => {
    it('EVM steps: flat shape with NO tx_encoding field, provider: "yield_xyz" at top level', () => {
      const resp = makeEvmActionResponse()
      const display = parseActionDisplay(resp)

      expect(display.provider).toBe('yield_xyz')
      expect(display.chain).toBe('Base')
      expect(display.transactions).toHaveLength(2)

      const step0 = display.transactions[0] as Record<string, unknown>
      expect(step0.to).toBeTruthy()
      expect(step0.data).toBeTruthy()
      // EVM steps MUST NOT have tx_encoding
      expect(step0.tx_encoding).toBeUndefined()
      expect(step0.action).toBe('APPROVAL')
      expect(step0.description).toBe('Approve USDC')
      expect(step0.from).toBe('0x1234567890123456789012345678901234567890')

      const step1 = display.transactions[1] as Record<string, unknown>
      expect(step1.tx_encoding).toBeUndefined()
      // gas hints from unsignedTransaction
      expect(step1.gas_limit).toBe('200000')
      expect(step1.max_fee_per_gas).toBe('0x5f5e100')
    })

    it('Non-EVM (Solana) step has tx_encoding: "solana-tx"', () => {
      const resp = makeSolanaActionResponse()
      const display = parseActionDisplay(resp)

      expect(display.chain).toBe('Solana')
      expect(display.provider).toBe('yield_xyz')
      expect(display.transactions).toHaveLength(1)

      const step = display.transactions[0] as Record<string, unknown>
      expect(step.tx_encoding).toBe('solana-tx')
      expect(typeof step.data).toBe('string')
      // No EVM fields
      expect(step.to).toBeUndefined()
    })

    it('per-step degrade: a step that fails to canonicalize falls back to decoded[] WITHOUT nuking the other steps', () => {
      const resp = makeEvmActionResponse({
        transactions: [
          {
            id: 'tx-good',
            title: 'Good step',
            type: 'APPROVAL',
            network: 'base',
            status: 'CREATED',
            unsignedTransaction: JSON.stringify({ to: '0xabc123', data: '0xdeadbeef', value: '0x0' }),
            gasEstimate: '{}',
          },
          {
            id: 'tx-bad',
            title: 'Bad step',
            type: 'SUPPLY',
            network: 'base',
            status: 'CREATED',
            // Missing `to` field — will fail EVM canonicalization
            unsignedTransaction: JSON.stringify({ value: '0x0', data: '0xdeadbeef' }),
            gasEstimate: '{}',
          },
        ],
      })
      const display = parseActionDisplay(resp)

      expect(display.transactions).toHaveLength(2)

      // The good step stays canonicalized (flat EVM shape).
      const step0 = display.transactions[0] as Record<string, unknown>
      expect(step0.to).toBe('0xabc123')
      expect(step0.data).toBe('0xdeadbeef')

      // Only the bad step degrades to its decoded fallback.
      const step1 = display.transactions[1] as Record<string, unknown>
      expect(step1.title).toBe('Bad step')
      expect(step1.to).toBeUndefined() // not the canonical EVM shape
    })

    it('unsupported network (e.g. Cardano) mid-action degrades only that step, keeps siblings canonical', () => {
      const resp = makeEvmActionResponse({
        transactions: [
          {
            id: 'tx-evm',
            title: 'EVM step',
            type: 'APPROVAL',
            network: 'base',
            status: 'CREATED',
            unsignedTransaction: JSON.stringify({ to: '0xabc123', data: '0xdeadbeef', value: '0x0' }),
            gasEstimate: '{}',
          },
          {
            id: 'tx-cardano',
            title: 'Cardano step',
            type: 'STAKE',
            network: 'cardano',
            status: 'CREATED',
            unsignedTransaction: JSON.stringify({ cbor: 'deadbeef' }),
            gasEstimate: '{}',
          },
        ],
      })
      const display = parseActionDisplay(resp)

      expect(display.transactions).toHaveLength(2)
      const evmStep = display.transactions[0] as Record<string, unknown>
      expect(evmStep.to).toBe('0xabc123')
      expect(evmStep.tx_encoding).toBeUndefined()

      const cardanoStep = display.transactions[1] as Record<string, unknown>
      expect(cardanoStep.title).toBe('Cardano step')
      expect(cardanoStep.network).toBe('cardano')
      expect(cardanoStep.to).toBeUndefined()
    })
  })

  describe('stakekitBuildEnter', () => {
    it('returns unsigned EVM calldata shape: flat {to, value, data, action, description}, provider: "yield_xyz", scan_request', async () => {
      const product = makeProduct()
      const actionResp = makeEvmActionResponse()

      globalThis.fetch = vi
        .fn()
        // First call: getYield (for resolveActionArgs)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => product,
          text: async () => JSON.stringify(product),
        } as Response)
        // Second call: MCP (will fail so REST fallback is used)
        .mockRejectedValueOnce(new Error('MCP unavailable'))
        // Third call: REST action
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => actionResp,
          text: async () => JSON.stringify(actionResp),
        } as Response)

      const result = await stakekitBuildEnter({
        yieldId: 'base-usdc-aave-v3-lending',
        address: '0x1234567890123456789012345678901234567890',
        amount: '100',
      })

      const r = result as Record<string, unknown>
      expect(r.provider).toBe('yield_xyz')
      expect(r.scan_request).toBeDefined()
      const scanReq = r.scan_request as Record<string, unknown>
      expect(scanReq.kind).toBe('evm')
      expect(scanReq.chain).toBe('Base')

      const txs = r.transactions as Record<string, unknown>[]
      expect(txs).toHaveLength(2)
      expect(txs[0].to).toBeTruthy()
      expect(txs[0].data).toBeTruthy()
      // EVM steps MUST NOT have tx_encoding
      expect(txs[0].tx_encoding).toBeUndefined()
    })

    it('threads the action address into Solana scan_requests for downstream scanners', async () => {
      const product = makeProduct({
        id: 'solana-sol-marinade-staking',
        token: { symbol: 'SOL', name: 'Solana', network: 'solana', decimals: 9 },
        tokens: [{ symbol: 'SOL', name: 'Solana', network: 'solana', decimals: 9 }],
      })
      const actionResp = makeSolanaActionResponse()

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => product,
          text: async () => JSON.stringify(product),
        } as Response)
        .mockRejectedValueOnce(new Error('MCP unavailable'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => actionResp,
          text: async () => JSON.stringify(actionResp),
        } as Response)

      const result = await stakekitBuildEnter({
        yieldId: 'solana-sol-marinade-staking',
        address: 'SoLwaLLetAddr1111111111111111111111111111',
        amount: '1',
      })

      expect(result.scan_requests[0]).toMatchObject({
        kind: 'solana',
        chain: 'Solana',
        accountAddress: 'SoLwaLLetAddr1111111111111111111111111111',
      })
    })

    it('omits X-API-KEY header when apiKey not supplied', async () => {
      const product = makeProduct()
      const actionResp = makeEvmActionResponse()

      const capturedHeaders: Record<string, string>[] = []
      globalThis.fetch = vi.fn().mockImplementation((url: unknown, opts: unknown) => {
        const options = opts as RequestInit | undefined
        capturedHeaders.push((options?.headers as Record<string, string>) ?? {})
        // Return product for getYield, actionResp for MCP fail/REST
        if (String(url).includes('/yields/')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => product,
            text: async () => JSON.stringify(product),
          } as Response)
        }
        if (String(url).includes('/mcp')) {
          return Promise.reject(new Error('MCP unavailable'))
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => actionResp,
          text: async () => JSON.stringify(actionResp),
        } as Response)
      })

      await stakekitBuildEnter({
        yieldId: 'base-usdc-aave-v3-lending',
        address: '0x1234567890123456789012345678901234567890',
        amount: '100',
        // NO apiKey
      })

      // No header should contain X-API-KEY
      for (const h of capturedHeaders) {
        expect(h['X-API-KEY']).toBeUndefined()
      }
    })

    it('injects X-API-KEY header when apiKey is supplied', async () => {
      const product = makeProduct()
      const actionResp = makeEvmActionResponse()

      const capturedHeaders: Record<string, string>[] = []
      globalThis.fetch = vi.fn().mockImplementation((url: unknown, opts: unknown) => {
        const options = opts as RequestInit | undefined
        capturedHeaders.push((options?.headers as Record<string, string>) ?? {})
        if (String(url).includes('/yields/')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => product,
            text: async () => JSON.stringify(product),
          } as Response)
        }
        if (String(url).includes('/mcp')) {
          return Promise.reject(new Error('MCP unavailable'))
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => actionResp,
          text: async () => JSON.stringify(actionResp),
        } as Response)
      })

      await stakekitBuildEnter({
        yieldId: 'base-usdc-aave-v3-lending',
        address: '0x1234567890123456789012345678901234567890',
        amount: '100',
        apiKey: 'test-key-123',
      })

      // At least one header set should include X-API-KEY
      const hasKey = capturedHeaders.some(h => h['X-API-KEY'] === 'test-key-123')
      expect(hasKey).toBe(true)
    })
  })

  describe('stakekitBuildExit', () => {
    it('returns same unsigned shape as enter + cooldown_days when cooldown present', async () => {
      const productWithCooldown = makeProduct({
        metadata: {
          name: 'Lido Staked ETH',
          type: 'liquid-staking',
          provider: { name: 'Lido' },
          cooldownPeriod: { days: 7 },
        },
      })
      const actionResp: YieldActionResponse = {
        id: 'action-exit',
        intent: 'EXIT',
        type: 'UNSTAKE',
        yieldId: 'ethereum-eth-lido-staking',
        amount: '1',
        amountRaw: '1000000000000000000',
        amountUsd: '3000',
        transactions: [
          {
            id: 'tx-exit-1',
            title: 'Unstake ETH',
            type: 'UNSTAKE',
            network: 'ethereum',
            status: 'CREATED',
            unsignedTransaction: JSON.stringify({
              to: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
              value: '0x0',
              data: '0x830c29ae0000000000000000000000000000000000000000000000000de0b6b3a7640000',
              from: '0x1234567890123456789012345678901234567890',
            }),
            gasEstimate: '{}',
          },
        ],
      }

      globalThis.fetch = vi
        .fn()
        // resolveActionArgs getYield
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => productWithCooldown,
          text: async () => JSON.stringify(productWithCooldown),
        } as Response)
        // MCP fails → REST fallback
        .mockRejectedValueOnce(new Error('MCP unavailable'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => actionResp,
          text: async () => JSON.stringify(actionResp),
        } as Response)
        // getYield for cooldown (parallel)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => productWithCooldown,
          text: async () => JSON.stringify(productWithCooldown),
        } as Response)

      const result = await stakekitBuildExit({
        yieldId: 'ethereum-eth-lido-staking',
        address: '0x1234567890123456789012345678901234567890',
        amount: '1',
      })

      const r = result as Record<string, unknown>
      expect(r.provider).toBe('yield_xyz')
      expect(r.scan_request).toBeDefined()
      expect(r.cooldown_days).toBe(7)
      const txs = r.transactions as Record<string, unknown>[]
      expect(txs[0].tx_encoding).toBeUndefined() // EVM: no tx_encoding
      expect(txs[0].to).toBeTruthy()
    })

    it('omits cooldown_days when no cooldown period', async () => {
      const product = makeProduct() // no cooldownPeriod
      const actionResp: YieldActionResponse = {
        id: 'action-exit-2',
        intent: 'EXIT',
        type: 'WITHDRAW',
        yieldId: 'base-usdc-aave-v3-lending',
        amount: '50',
        amountRaw: '50000000',
        amountUsd: '50',
        transactions: [
          {
            id: 'tx-exit-2',
            title: 'Withdraw USDC',
            type: 'WITHDRAW',
            network: 'base',
            status: 'CREATED',
            unsignedTransaction: JSON.stringify({
              to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb0',
              value: '0x0',
              data: '0x69328dec000000000000000000000000abc',
              from: '0x1234567890123456789012345678901234567890',
            }),
            gasEstimate: '{}',
          },
        ],
      }

      // Route by URL — Promise.all in stakekitBuildExit runs MCP + getYield in parallel
      // so we cannot rely on call order; use URL-based routing instead.
      globalThis.fetch = vi.fn().mockImplementation((url: unknown, _opts: unknown) => {
        const u = String(url)
        if (u.includes('/mcp')) {
          return Promise.reject(new Error('MCP unavailable'))
        }
        if (u.includes('/actions/')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => actionResp,
            text: async () => JSON.stringify(actionResp),
          } as Response)
        }
        // /yields/* — getYield or searchYields
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => product,
          text: async () => JSON.stringify(product),
        } as Response)
      })

      const result = await stakekitBuildExit({
        yieldId: 'base-usdc-aave-v3-lending',
        address: '0x1234567890123456789012345678901234567890',
        amount: '50',
      })

      const r = result as Record<string, unknown>
      expect(r.cooldown_days).toBeUndefined()
    })

    it('nests validatorAddresses inside args on the REST fallback, not as a top-level sibling (sdk#1535)', async () => {
      const product = makeProduct()
      const actionResp: YieldActionResponse = {
        id: 'action-exit-3',
        intent: 'EXIT',
        type: 'UNSTAKE',
        yieldId: 'ethereum-eth-lido-staking',
        amount: '1',
        amountRaw: '1000000000000000000',
        amountUsd: '3000',
        transactions: [
          {
            id: 'tx-exit-3',
            title: 'Unstake ETH',
            type: 'UNSTAKE',
            network: 'ethereum',
            status: 'CREATED',
            unsignedTransaction: JSON.stringify({
              to: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
              value: '0x0',
              data: '0x830c29ae',
              from: '0x1234567890123456789012345678901234567890',
            }),
            gasEstimate: '{}',
          },
        ],
      }

      const capturedBodies: Record<string, unknown>[] = []
      globalThis.fetch = vi.fn().mockImplementation((url: unknown, opts: unknown) => {
        const u = String(url)
        if (u.includes('/mcp')) {
          return Promise.reject(new Error('MCP unavailable'))
        }
        if (u.includes('/actions/')) {
          const options = opts as RequestInit | undefined
          capturedBodies.push(JSON.parse(String(options?.body)) as Record<string, unknown>)
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => actionResp,
            text: async () => JSON.stringify(actionResp),
          } as Response)
        }
        // /yields/* — getYield (both resolveActionArgs and the parallel cooldown lookup)
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => product,
          text: async () => JSON.stringify(product),
        } as Response)
      })

      await stakekitBuildExit({
        yieldId: 'ethereum-eth-lido-staking',
        address: '0x1234567890123456789012345678901234567890',
        amount: '1',
        validatorAddresses: ['0xvalidator1'],
      })

      expect(capturedBodies).toHaveLength(1)
      const body = capturedBodies[0]
      expect(body.validatorAddresses).toBeUndefined()
      expect((body.args as Record<string, unknown>).validatorAddresses).toEqual(['0xvalidator1'])
    })
  })

  describe('stakekitDetails', () => {
    it('returns the canonical StakekitDetailsResult shape from a StakeKit product', async () => {
      // Distinct yieldId — getYield caches by id for 5 min, and other tests in
      // this file already populate the cache for 'ethereum-eth-lido-staking'.
      const product = makeProduct({
        id: 'ethereum-eth-lido-staking-details-test',
        metadata: {
          name: 'Lido Staked ETH',
          type: 'liquid-staking',
          provider: { name: 'Lido' },
          cooldownPeriod: { days: 3 },
          warmupPeriod: { days: 1 },
          rewardSchedule: 'daily',
          rewardClaiming: 'auto',
        },
        fee: { enabled: true, percentage: 10 },
      })

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => product,
        text: async () => JSON.stringify(product),
      } as Response)

      const result = await stakekitDetails({ yieldId: 'ethereum-eth-lido-staking-details-test' })

      expect(result).toEqual({
        id: 'ethereum-eth-lido-staking-details-test',
        name: 'Lido Staked ETH',
        token: 'ETH',
        network: 'ethereum',
        apy: 0.0421,
        type: 'liquid-staking',
        provider: 'Lido',
        isAvailable: true,
        fee: { percentage: 10 },
        cooldownDays: 3,
        warmupDays: 1,
        rewardSchedule: 'daily',
        rewardClaiming: 'auto',
        enterEnabled: true,
        exitEnabled: true,
        acceptedTokens: [{ symbol: 'ETH', network: 'ethereum', address: undefined }],
      })
    })
  })

  describe('yieldNetworkToCanonicalChain', () => {
    it('maps known yield.xyz network slugs to the app PascalCase chain name', () => {
      expect(yieldNetworkToCanonicalChain('ethereum')).toBe('Ethereum')
      expect(yieldNetworkToCanonicalChain('avalanche-c')).toBe('Avalanche')
      expect(yieldNetworkToCanonicalChain('binance')).toBe('BSC')
      expect(yieldNetworkToCanonicalChain('solana')).toBe('Solana')
    })

    it('returns null for unrecognized network slugs', () => {
      expect(yieldNetworkToCanonicalChain('not-a-real-network')).toBeNull()
    })
  })

  describe('stakekitBalances', () => {
    it('uses the same canonical network aliases as search', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [], hasNextPage: false }),
        text: async () => '',
      } as Response)
      globalThis.fetch = fetchMock

      const result = await stakekitBalances({
        address: '0x1234567890123456789012345678901234567890',
        network: 'AVAX',
      })

      expect(result).toEqual([])
      const requestUrl = String(fetchMock.mock.calls[0]?.[0])
      expect(new URL(requestUrl).searchParams.get('network')).toBe('avalanche-c')
    })

    it('returns null on 403 (restricted endpoint)', async () => {
      // searchYields (to enumerate integration IDs)
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: [makeProduct()], hasNextPage: false }),
          text: async () => '',
        } as Response)
        // balances POST → 403
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          json: async () => ({}),
          text: async () => 'Forbidden',
        } as Response)

      const result = await stakekitBalances({
        address: '0x1234567890123456789012345678901234567890',
        network: 'ethereum',
      })
      expect(result).toBeNull()
    })
  })
})

describe('action-input validation (ported from mcp-ts validateActionInput, Apo #192)', () => {
  const EVM = '0x' + 'a'.repeat(40)
  const SUI = '0x' + 'b'.repeat(64)

  it('validateStakekitActionAddress: accepts EVM (40 hex), Sui (64 hex), and non-0x; rejects bad 0x lengths', () => {
    expect(validateStakekitActionAddress(EVM)).toBeNull()
    expect(validateStakekitActionAddress(SUI)).toBeNull()
    expect(validateStakekitActionAddress('cosmos1abc')).toBeNull() // non-0x passes (server-validated)
    expect(validateStakekitActionAddress('terra1xyz')).toBeNull()
    // 42-hex "EVM-ish" 0x that is NEITHER 40 nor 64 -> rejected locally (the Sui-fix regression guard)
    expect(validateStakekitActionAddress('0x' + 'c'.repeat(42))).toMatch(/EVM \(40 hex chars\) or Sui \(64 hex chars\)/)
    expect(validateStakekitActionAddress('0xdeadbeef')).toMatch(/Invalid 0x-prefixed address/)
  })

  it('validateStakekitActionInput: rejects non-positive and non-plain-decimal amounts', () => {
    expect(validateStakekitActionInput(EVM, '5')).toBeNull()
    expect(validateStakekitActionInput(EVM, '0.0001')).toBeNull()
    expect(validateStakekitActionInput(EVM, '.5')).toBeNull()
    expect(validateStakekitActionInput(EVM, '1.')).toBeNull()
    expect(validateStakekitActionInput(EVM, '1' + '0'.repeat(400))).toBeNull()
    expect(validateStakekitActionInput(EVM, '0')).toMatch(/plain decimal string/)
    expect(validateStakekitActionInput(EVM, '-1')).toMatch(/plain decimal string/)
    expect(validateStakekitActionInput(EVM, 'abc')).toMatch(/plain decimal string/)
    expect(validateStakekitActionInput(EVM, '1e3')).toMatch(/plain decimal string/)
    expect(validateStakekitActionInput(EVM, 'Infinity')).toMatch(/plain decimal string/)
    expect(validateStakekitActionInput(EVM, '0x10')).toMatch(/plain decimal string/)
    expect(validateStakekitActionInput(EVM, ' 1 ')).toMatch(/plain decimal string/)
    expect(validateStakekitActionInput(EVM, '\t0.5')).toMatch(/plain decimal string/)
    // address error takes precedence over amount
    expect(validateStakekitActionInput('0xbad', '5')).toMatch(/Invalid 0x-prefixed address/)
  })

  it('stakekitBuildEnter throws on a malformed 0x address BEFORE any network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(
      stakekitBuildEnter({ yieldId: 'ethereum-eth-lido-staking', address: '0x' + 'c'.repeat(42), amount: '1' })
    ).rejects.toThrow(/EVM \(40 hex chars\) or Sui \(64 hex chars\)/)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('stakekitBuildEnter throws on a non-positive amount BEFORE any network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(
      stakekitBuildEnter({ yieldId: 'ethereum-eth-lido-staking', address: '0x' + 'a'.repeat(40), amount: '0' })
    ).rejects.toThrow(/plain decimal string/)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('stakekitBuildExit throws on a malformed 0x address BEFORE any network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(
      stakekitBuildExit({ yieldId: 'ethereum-eth-lido-staking', address: '0xdeadbeef', amount: '1' })
    ).rejects.toThrow(/Invalid 0x-prefixed address/)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})

// architecture#1670: scan surface used to be singular (first scannable step
// only) and EVM-only. buildYieldActionScanRequests (plural) hands back ALL
// steps, and Solana steps now get a real `solana` scan_request instead of
// the generic `chain_not_supported` sentinel.
describe('scan-request coverage (architecture#1670)', () => {
  const makeSolanaTx = (overrides: Partial<YieldTransaction> = {}): YieldTransaction => ({
    id: 'tx-sol-1',
    title: 'Stake SOL',
    type: 'STAKE',
    network: 'solana',
    status: 'CREATED',
    unsignedTransaction: 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    gasEstimate: '{}',
    ...overrides,
  })

  it('buildYieldActionScanRequests returns one entry PER step, 1:1 with transactions[]', () => {
    const resp = makeEvmActionResponse()
    const reqs = buildYieldActionScanRequests(resp)
    expect(reqs).toHaveLength(2)
    expect(reqs[0].kind).toBe('evm')
    expect(reqs[1].kind).toBe('evm')
    if (reqs[0].kind === 'evm') expect(reqs[0].to).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
    if (reqs[1].kind === 'evm') expect(reqs[1].to).toBe('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb0')
  })

  it('buildYieldActionScanRequest (singular) stays backward-compatible: first non-unsupported step only', () => {
    const resp = makeEvmActionResponse()
    const single = buildYieldActionScanRequest(resp)
    const plural = buildYieldActionScanRequests(resp)
    expect(single).toEqual(plural[0])
  })

  it('withScanRequests keeps the singular fallback at no_compiled_txs when every step is unsupported', async () => {
    const product = makeProduct({
      id: 'cosmos-atom-some-staking',
      token: { symbol: 'ATOM', name: 'Cosmos', network: 'cosmos-hub', decimals: 6 },
      tokens: [{ symbol: 'ATOM', name: 'Cosmos', network: 'cosmos-hub', decimals: 6 }],
    })
    const actionResp = makeSolanaActionResponse()

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => product,
        text: async () => JSON.stringify(product),
      } as Response)
      .mockRejectedValueOnce(new Error('MCP unavailable'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ...actionResp,
          yieldId: 'cosmos-atom-some-staking',
          transactions: actionResp.transactions.map((tx: YieldTransaction) => ({ ...tx, network: 'cosmos-hub' })),
        }),
        text: async () =>
          JSON.stringify({
            ...actionResp,
            yieldId: 'cosmos-atom-some-staking',
            transactions: actionResp.transactions.map((tx: YieldTransaction) => ({ ...tx, network: 'cosmos-hub' })),
          }),
      } as Response)

    const result = await stakekitBuildEnter({
      yieldId: 'cosmos-atom-some-staking',
      address: 'cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a',
      amount: '1',
    })

    expect(result.scan_requests).toEqual([{ kind: 'unsupported', reason: 'chain_not_supported' }])
    expect(result.scan_request).toEqual({ kind: 'unsupported', reason: 'no_compiled_txs' })
  })

  it('a Solana step gets a real `solana` scan_request, not chain_not_supported (was the bug)', () => {
    const resp = makeSolanaActionResponse()
    const req = buildYieldActionScanRequest(resp)
    expect(req.kind).toBe('solana')
    if (req.kind === 'solana') {
      expect(req.chain).toBe('Solana')
      expect(req.serializedTx).toBe(resp.transactions[0].unsignedTransaction)
      expect(req.accountAddress).toBeUndefined()
    }
  })

  it('a Solana step includes accountAddress when the caller supplies one', () => {
    const req = buildYieldStepScanRequest(makeSolanaTx(), 'SoLwaLLetAddr1111111111111111111111111111')
    expect(req.kind).toBe('solana')
    if (req.kind === 'solana') expect(req.accountAddress).toBe('SoLwaLLetAddr1111111111111111111111111111')
  })

  it('a Solana step with an empty tx string falls back to unsupported: no_compiled_txs', () => {
    const req = buildYieldStepScanRequest(makeSolanaTx({ unsignedTransaction: '' }))
    expect(req).toEqual({ kind: 'unsupported', reason: 'no_compiled_txs' })
  })

  it.each(['{}', '{"serialized":'])(
    'rejects JSON-like Solana wrapper %s instead of scanning the wrapper text as transaction bytes',
    unsignedTransaction => {
      const req = buildYieldStepScanRequest({
        network: 'solana',
        unsignedTransaction,
      } as YieldTransaction)
      expect(req).toEqual({ kind: 'unsupported', reason: 'no_compiled_txs' })
    }
  )

  it('a chain with no first-party scan surface still yields unsupported: chain_not_supported', () => {
    const req = buildYieldStepScanRequest(makeSolanaTx({ network: 'cosmos-hub' }))
    expect(req).toEqual({ kind: 'unsupported', reason: 'chain_not_supported' })
  })

  it('a 2-transaction action yields TWO scan requests via the plural helper, not just one', () => {
    // Regression guard for the issue's own pinned "2-transaction action still
    // yields one scan request" evidence — that's still true of the SINGULAR
    // helper (by design, for backward compat), but must no longer be true of
    // the plural one.
    const resp = makeEvmActionResponse()
    expect(resp.transactions).toHaveLength(2)
    expect(buildYieldActionScanRequests(resp)).toHaveLength(2)
  })

  it('buildYieldActionScanRequests returns [] when the action has no transactions', () => {
    const resp = makeEvmActionResponse({ transactions: [] })
    expect(buildYieldActionScanRequests(resp)).toEqual([])
  })
})
