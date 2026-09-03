import type { VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AgentExecutor } from '../executor'

type EvmSigner = {
  signEvmServerTx(
    serverTxData: Record<string, unknown>,
    defaultChain: Chain,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>>
}

type EvmNonceAccess = {
  fetchEvmPendingNonce(chain: Chain): Promise<bigint | null>
  patchEvmNonce(chain: Chain, payload: ReturnType<typeof createEvmPayload>): Promise<void>
  stateStore: {
    acquireChainLock: ReturnType<typeof vi.fn>
    clearEvmState: ReturnType<typeof vi.fn>
    getNextEvmNonce: ReturnType<typeof vi.fn>
    recordEvmNonce: ReturnType<typeof vi.fn>
  }
}

type EvmGasAccess = {
  patchEvmGas(chain: Chain, payload: ReturnType<typeof createEvmPayload>): Promise<void>
}

function createEvmPayload() {
  return {
    blockchainSpecific: {
      case: 'ethereumSpecific',
      value: {
        gasLimit: '21000',
        maxFeePerGasWei: '2000000000',
        nonce: 1n,
        priorityFee: '1000000000',
      },
    },
  }
}

function createSigningVault(payload: ReturnType<typeof createEvmPayload>): VaultBase {
  return {
    name: 'mock-vault',
    id: 'vault-mock-1',
    type: 'secure',
    chains: [Chain.Ethereum, Chain.Polygon],
    isEncrypted: false,
    address: vi.fn().mockResolvedValue('0xsender'),
    balance: vi.fn().mockResolvedValue({ decimals: 18, symbol: 'ETH' }),
    prepareRawEvmTx: vi.fn().mockResolvedValue(payload),
    extractMessageHashes: vi.fn().mockResolvedValue(['0xmessage']),
    sign: vi.fn().mockResolvedValue({ r: '0xr', s: '0xs', recoveryId: 0 }),
    broadcastTx: vi.fn().mockResolvedValue('0xtxhash'),
  } as unknown as VaultBase
}

function withNonceState(executor: AgentExecutor, nextNonce: bigint) {
  const access = executor as unknown as EvmNonceAccess
  access.stateStore = {
    acquireChainLock: vi.fn().mockResolvedValue(vi.fn()),
    clearEvmState: vi.fn(),
    getNextEvmNonce: vi.fn().mockReturnValue(nextNonce),
    recordEvmNonce: vi.fn(),
  }
  return access
}

function stubGasRefresh(executor: AgentExecutor) {
  return vi.spyOn(executor as unknown as EvmGasAccess, 'patchEvmGas').mockResolvedValue(undefined)
}

function mockEvmFeeRpc(baseFee: bigint, priorityFee: bigint) {
  const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { method: string }
    const result =
      request.method === 'eth_getBlockByNumber'
        ? { baseFeePerGas: `0x${baseFee.toString(16)}` }
        : `0x${priorityFee.toString(16)}`

    return {
      json: vi.fn().mockResolvedValue({ jsonrpc: '2.0', result }),
      ok: true,
      status: 200,
    }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('AgentExecutor raw EVM envelope preparation', () => {
  it('passes raw transaction fields to the SDK helper and refreshes gas before hashing', async () => {
    const payload = createEvmPayload()
    const vault = createSigningVault(payload)
    const executor = new AgentExecutor(vault)
    const patchGas = stubGasRefresh(executor)

    const result = await (executor as unknown as EvmSigner).signEvmServerTx(
      {
        chain: Chain.Ethereum,
        tx: {
          data: '0x095ea7b3',
          gas_limit: '60000',
          max_fee_per_gas: '3000000000',
          max_priority_fee_per_gas: '1000000000',
          nonce: '7',
          to: '0xrecipient',
          value: '0',
        },
      },
      Chain.Ethereum,
      {}
    )

    expect(vault.prepareRawEvmTx).toHaveBeenCalledWith({
      chain: Chain.Ethereum,
      tx: {
        data: '0x095ea7b3',
        gasLimit: '60000',
        maxFeePerGas: '3000000000',
        maxPriorityFeePerGas: '1000000000',
        nonce: '7',
        to: '0xrecipient',
        value: '0',
      },
    })
    expect(vault.sign).toHaveBeenCalledOnce()
    expect(vault.broadcastTx).toHaveBeenCalledOnce()
    expect(result.tx_hash).toBe('0xtxhash')
    expect(patchGas).toHaveBeenCalledWith(Chain.Ethereum, payload)
    expect(patchGas.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(vault.extractMessageHashes).mock.invocationCallOrder[0]
    )
  })

  it('preserves value-bearing camelCase main-call fields through sign and broadcast', async () => {
    const payload = createEvmPayload()
    const vault = createSigningVault(payload)
    const executor = new AgentExecutor(vault)
    stubGasRefresh(executor)

    const result = await (executor as unknown as EvmSigner).signEvmServerTx(
      {
        chain: Chain.Base,
        tx: {
          data: '0xd0e30db0',
          gasLimit: 125_000n,
          maxFeePerGas: 3_000_000_000n,
          maxPriorityFeePerGas: 1_000_000_000n,
          nonce: 8n,
          to: '0xrecipient',
          value: 1_000_000_000_000_000n,
        },
      },
      Chain.Ethereum,
      {}
    )

    expect(vault.prepareRawEvmTx).toHaveBeenCalledWith({
      chain: Chain.Base,
      tx: {
        data: '0xd0e30db0',
        gasLimit: 125_000n,
        maxFeePerGas: 3_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
        nonce: 8n,
        to: '0xrecipient',
        value: 1_000_000_000_000_000n,
      },
    })
    expect(vault.sign).toHaveBeenCalledOnce()
    expect(vault.broadcastTx).toHaveBeenCalledOnce()
    expect(result.tx_hash).toBe('0xtxhash')
  })

  it('reconciles a stale raw nonce with locally pending transactions before signing', async () => {
    const payload = createEvmPayload()
    payload.blockchainSpecific.value.nonce = 7n
    const vault = createSigningVault(payload)
    const executor = new AgentExecutor(vault)
    const nonceAccess = withNonceState(executor, 8n)
    stubGasRefresh(executor)
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        jsonrpc: '2.0',
        result: '0x8',
      }),
      ok: true,
      status: 200,
    })
    vi.stubGlobal('fetch', fetchMock)

    await (executor as unknown as EvmSigner).signEvmServerTx(
      {
        chain: Chain.Ethereum,
        tx: {
          data: '0x',
          gasLimit: 21_000n,
          maxFeePerGas: 3_000_000_000n,
          maxPriorityFeePerGas: 1_000_000_000n,
          nonce: 7n,
          to: '0xrecipient',
          value: 1n,
        },
      },
      Chain.Ethereum,
      {}
    )

    expect(payload.blockchainSpecific.value.nonce).toBe(8n)
    expect(vault.extractMessageHashes).toHaveBeenCalledWith(payload)
    expect(vault.sign).toHaveBeenCalledWith(expect.objectContaining({ transaction: payload }), {})
    expect(nonceAccess.stateStore.recordEvmNonce).toHaveBeenCalledWith(Chain.Ethereum, 8n)
    expect(nonceAccess.stateStore.clearEvmState).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

describe('AgentExecutor EVM pending nonce', () => {
  it('warns without verbose and keeps a small-gap local nonce when an HTTP error is unverifiable', async () => {
    const payload = createEvmPayload()
    const executor = new AgentExecutor(createSigningVault(payload))
    const nonceAccess = withNonceState(executor, 3n)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        jsonrpc: '2.0',
        result: '0xa',
      }),
      ok: false,
      status: 401,
    })
    vi.stubGlobal('fetch', fetchMock)

    await nonceAccess.patchEvmNonce(Chain.Polygon, payload)

    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining('pending nonce was not verified for Polygon; signing will continue with local nonce 3')
    )
    expect(payload.blockchainSpecific.value.nonce).toBe(3n)
    expect(nonceAccess.stateStore.clearEvmState).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('keeps the existing on-chain fallback when a correct large-gap local state cannot be verified', async () => {
    const payload = createEvmPayload()
    const executor = new AgentExecutor(createSigningVault(payload))
    // Model four correctly queued local transactions that the independent RPC cannot verify.
    const nonceAccess = withNonceState(executor, 5n)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        jsonrpc: '2.0',
        result: '0x5',
      }),
      ok: false,
      status: 503,
    })
    vi.stubGlobal('fetch', fetchMock)

    await nonceAccess.patchEvmNonce(Chain.Ethereum, payload)

    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining(
        'pending nonce was not verified for Ethereum; signing will continue with on-chain nonce 1'
      )
    )
    expect(payload.blockchainSpecific.value.nonce).toBe(1n)
    expect(nonceAccess.stateStore.clearEvmState).toHaveBeenCalledWith(Chain.Ethereum)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('returns null for a JSON-RPC error delivered over HTTP 200', async () => {
    const executor = new AgentExecutor(createSigningVault(createEvmPayload()))
    const nonceAccess = executor as unknown as EvmNonceAccess
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        error: { code: -32051, message: 'tenant disabled' },
        jsonrpc: '2.0',
        result: '0xa',
      }),
      ok: true,
      status: 200,
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(nonceAccess.fetchEvmPendingNonce(Chain.Ethereum)).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('returns null when the pending-nonce fetch rejects', async () => {
    const executor = new AgentExecutor(createSigningVault(createEvmPayload()))
    const nonceAccess = executor as unknown as EvmNonceAccess
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(nonceAccess.fetchEvmPendingNonce(Chain.Ethereum)).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('returns null when the pending-nonce response body rejects', async () => {
    const executor = new AgentExecutor(createSigningVault(createEvmPayload()))
    const nonceAccess = executor as unknown as EvmNonceAccess
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockRejectedValue(new Error('invalid JSON')),
      ok: true,
      status: 200,
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(nonceAccess.fetchEvmPendingNonce(Chain.Ethereum)).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('preserves a genuine zero nonce and still rejects a response with no result', async () => {
    const payload = createEvmPayload()
    payload.blockchainSpecific.value.nonce = 0n
    const executor = new AgentExecutor(createSigningVault(payload))
    const nonceAccess = withNonceState(executor, 5n)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          jsonrpc: '2.0',
          result: '0x0',
        }),
        ok: true,
        status: 200,
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          jsonrpc: '2.0',
          result: 0,
        }),
        ok: true,
        status: 200,
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          jsonrpc: '2.0',
          result: '0x0',
        }),
        ok: true,
        status: 200,
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          jsonrpc: '2.0',
        }),
        ok: true,
        status: 200,
      })
    vi.stubGlobal('fetch', fetchMock)

    await nonceAccess.patchEvmNonce(Chain.Ethereum, payload)

    expect(payload.blockchainSpecific.value.nonce).toBe(0n)
    expect(nonceAccess.stateStore.clearEvmState).toHaveBeenCalledWith(Chain.Ethereum)
    await expect(nonceAccess.fetchEvmPendingNonce(Chain.Ethereum)).resolves.toBe(0n)
    await expect(nonceAccess.fetchEvmPendingNonce(Chain.Ethereum)).resolves.toBe(0n)
    await expect(nonceAccess.fetchEvmPendingNonce(Chain.Ethereum)).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('keeps normal non-zero nonce handling while treating a null result as a failure', async () => {
    const payload = createEvmPayload()
    payload.blockchainSpecific.value.nonce = 4n
    const executor = new AgentExecutor(createSigningVault(payload))
    const nonceAccess = withNonceState(executor, 5n)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          jsonrpc: '2.0',
          result: '0x5',
        }),
        ok: true,
        status: 200,
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          jsonrpc: '2.0',
          result: null,
        }),
        ok: true,
        status: 200,
      })
    vi.stubGlobal('fetch', fetchMock)

    await nonceAccess.patchEvmNonce(Chain.Ethereum, payload)

    expect(payload.blockchainSpecific.value.nonce).toBe(5n)
    expect(nonceAccess.stateStore.clearEvmState).not.toHaveBeenCalled()
    await expect(nonceAccess.fetchEvmPendingNonce(Chain.Ethereum)).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('AgentExecutor EIP-1559 fee refresh', () => {
  it.each([
    ['timeout', () => Promise.reject(new DOMException('timed out', 'TimeoutError'))],
    [
      'HTTP error',
      () =>
        Promise.resolve({
          json: vi.fn().mockResolvedValue({ jsonrpc: '2.0', result: { baseFeePerGas: '0x2540be400' } }),
          ok: false,
          status: 503,
        }),
    ],
    [
      'JSON-RPC error',
      () =>
        Promise.resolve({
          json: vi.fn().mockResolvedValue({
            error: { code: -32000, message: 'upstream unavailable' },
            jsonrpc: '2.0',
          }),
          ok: true,
          status: 200,
        }),
    ],
  ])('still applies the Polygon floor and fee-cap invariant when the base-fee RPC has a %s', async (_label, reply) => {
    const payload = createEvmPayload()
    payload.blockchainSpecific.value.maxFeePerGasWei = '0'
    payload.blockchainSpecific.value.priorityFee = '0'
    const executor = new AgentExecutor(createSigningVault(payload))
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const fetchMock = vi.fn(reply)
    vi.stubGlobal('fetch', fetchMock)

    await (executor as unknown as EvmGasAccess).patchEvmGas(Chain.Polygon, payload)

    expect(payload.blockchainSpecific.value.priorityFee).toBe('30000000000')
    expect(payload.blockchainSpecific.value.maxFeePerGasWei).toBe('30000000000')
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('gas estimate was not refreshed for Polygon'))
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining(
        'fees adjusted after confirmation: maxPriorityFeePerGas 0 → 30000000000, maxFeePerGas 0 → 30000000000'
      )
    )
    // Base-fee and priority-fee lookups are independent requests.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('fills a zero tip from the live priority-fee RPC even when the base-fee RPC fails', async () => {
    const payload = createEvmPayload()
    payload.blockchainSpecific.value.maxFeePerGasWei = '0'
    payload.blockchainSpecific.value.priorityFee = '0'
    const executor = new AgentExecutor(createSigningVault(payload))
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { method: string }
      if (request.method === 'eth_getBlockByNumber') throw new Error('ECONNREFUSED')
      return {
        json: vi.fn().mockResolvedValue({ jsonrpc: '2.0', result: `0x${40_000_000_000n.toString(16)}` }),
        ok: true,
        status: 200,
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    await (executor as unknown as EvmGasAccess).patchEvmGas(Chain.Polygon, payload)

    // The live 40 gwei suggestion wins over the 30 gwei floor fallback.
    expect(payload.blockchainSpecific.value.priorityFee).toBe('40000000000')
    expect(payload.blockchainSpecific.value.maxFeePerGasWei).toBe('40000000000')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('fills a zero Polygon tip from RPC and applies the pinned validator minimum', async () => {
    const payload = createEvmPayload()
    payload.blockchainSpecific.value.maxFeePerGasWei = '0'
    payload.blockchainSpecific.value.priorityFee = '0'
    const executor = new AgentExecutor(createSigningVault(payload))
    mockEvmFeeRpc(10_000_000_000n, 1_000_000_000n)

    await (executor as unknown as EvmGasAccess).patchEvmGas(Chain.Polygon, payload)

    const priorityFee = BigInt(payload.blockchainSpecific.value.priorityFee)
    const maxFee = BigInt(payload.blockchainSpecific.value.maxFeePerGasWei)
    expect(priorityFee).toBeGreaterThan(0n)
    expect(priorityFee).toBeGreaterThanOrEqual(25_000_000_000n)
    expect(priorityFee).toBeLessThanOrEqual(maxFee)
  })

  it('keeps a builder-supplied nonzero tip when it is above the hard chain floor', async () => {
    const payload = createEvmPayload()
    payload.blockchainSpecific.value.maxFeePerGasWei = '100000000000'
    payload.blockchainSpecific.value.priorityFee = '40000000000'
    const executor = new AgentExecutor(createSigningVault(payload))
    const fetchMock = mockEvmFeeRpc(10_000_000_000n, 99_000_000_000n)

    await (executor as unknown as EvmGasAccess).patchEvmGas(Chain.Polygon, payload)

    expect(payload.blockchainSpecific.value.priorityFee).toBe('40000000000')
    expect(BigInt(payload.blockchainSpecific.value.priorityFee)).toBeLessThanOrEqual(
      BigInt(payload.blockchainSpecific.value.maxFeePerGasWei)
    )
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('clamps an excessive builder tip in both directions and warns without verbose mode', async () => {
    const payload = createEvmPayload()
    payload.blockchainSpecific.value.maxFeePerGasWei = '20000000000000'
    payload.blockchainSpecific.value.priorityFee = '10000000000000'
    const executor = new AgentExecutor(createSigningVault(payload))
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const fetchMock = mockEvmFeeRpc(10_000_000_000n, 1_000_000_000n)

    await (executor as unknown as EvmGasAccess).patchEvmGas(Chain.Ethereum, payload)

    expect(payload.blockchainSpecific.value.priorityFee).toBe('500000000000')
    expect(payload.blockchainSpecific.value.maxFeePerGasWei).toBe('20000000000000')
    expect(BigInt(payload.blockchainSpecific.value.priorityFee)).toBeLessThanOrEqual(
      BigInt(payload.blockchainSpecific.value.maxFeePerGasWei)
    )
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining(
        'maxPriorityFeePerGas 10000000000000 exceeded the safety ceiling; clamped to 500000000000'
      )
    )
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('fees adjusted after confirmation'))
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('raises a below-floor builder tip without consulting the priority RPC', async () => {
    const payload = createEvmPayload()
    payload.blockchainSpecific.value.maxFeePerGasWei = '100000000000'
    payload.blockchainSpecific.value.priorityFee = '1000000000'
    const executor = new AgentExecutor(createSigningVault(payload))
    const fetchMock = mockEvmFeeRpc(10_000_000_000n, 99_000_000_000n)

    await (executor as unknown as EvmGasAccess).patchEvmGas(Chain.Polygon, payload)

    expect(payload.blockchainSpecific.value.priorityFee).toBe('30000000000')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('clamps an anomalous RPC tip and raises maxFeePerGas to preserve the fee-cap invariant', async () => {
    const payload = createEvmPayload()
    payload.blockchainSpecific.value.maxFeePerGasWei = '1'
    payload.blockchainSpecific.value.priorityFee = '0'
    const executor = new AgentExecutor(createSigningVault(payload))
    mockEvmFeeRpc(10_000_000_000n, 10_000_000_000_000n)

    await (executor as unknown as EvmGasAccess).patchEvmGas(Chain.Base, payload)

    const priorityFee = BigInt(payload.blockchainSpecific.value.priorityFee)
    const maxFee = BigInt(payload.blockchainSpecific.value.maxFeePerGasWei)
    expect(priorityFee).toBe(50_000_000_000n)
    expect(priorityFee).toBeLessThanOrEqual(maxFee)
  })

  it('uses a nonzero base-fee fallback when an EIP-1559 RPC suggests a zero tip', async () => {
    const payload = createEvmPayload()
    payload.blockchainSpecific.value.maxFeePerGasWei = '0'
    payload.blockchainSpecific.value.priorityFee = '0'
    const executor = new AgentExecutor(createSigningVault(payload))
    mockEvmFeeRpc(10_000_000_000n, 0n)

    await (executor as unknown as EvmGasAccess).patchEvmGas(Chain.Base, payload)

    expect(BigInt(payload.blockchainSpecific.value.priorityFee)).toBeGreaterThan(0n)
  })

  it('uses the fallback when the optional priority RPC throws', async () => {
    const payload = createEvmPayload()
    payload.blockchainSpecific.value.maxFeePerGasWei = '0'
    payload.blockchainSpecific.value.priorityFee = '0'
    const executor = new AgentExecutor(createSigningVault(payload))
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { method: string }
      if (request.method === 'eth_maxPriorityFeePerGas') throw new Error('unsupported method')

      return {
        json: vi.fn().mockResolvedValue({ jsonrpc: '2.0', result: { baseFeePerGas: '0x2540be400' } }),
        ok: true,
        status: 200,
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    await (executor as unknown as EvmGasAccess).patchEvmGas(Chain.Base, payload)

    expect(payload.blockchainSpecific.value.priorityFee).toBe('1000000000')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each(['HTTP error', 'JSON-RPC error'])('uses the bounded fallback for a priority-fee %s', async failure => {
    const payload = createEvmPayload()
    payload.blockchainSpecific.value.maxFeePerGasWei = '0'
    payload.blockchainSpecific.value.priorityFee = '0'
    const executor = new AgentExecutor(createSigningVault(payload))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({ jsonrpc: '2.0', result: { baseFeePerGas: '0x2540be400' } }),
        ok: true,
        status: 200,
      })
      .mockResolvedValueOnce({
        json: vi
          .fn()
          .mockResolvedValue(
            failure === 'JSON-RPC error'
              ? { error: { code: -32601, message: 'method not found' }, jsonrpc: '2.0' }
              : { jsonrpc: '2.0', result: '0x174876e800' }
          ),
        ok: failure !== 'HTTP error',
        status: failure === 'HTTP error' ? 404 : 200,
      })
    vi.stubGlobal('fetch', fetchMock)

    await (executor as unknown as EvmGasAccess).patchEvmGas(Chain.Base, payload)

    expect(payload.blockchainSpecific.value.priorityFee).toBe('1000000000')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('caps the base-fee fallback at 2 gwei when the priority RPC is unavailable', async () => {
    const payload = createEvmPayload()
    payload.blockchainSpecific.value.maxFeePerGasWei = '0'
    payload.blockchainSpecific.value.priorityFee = '0'
    const executor = new AgentExecutor(createSigningVault(payload))
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { method: string }
      if (request.method === 'eth_maxPriorityFeePerGas') throw new Error('unsupported method')

      return {
        json: vi.fn().mockResolvedValue({ jsonrpc: '2.0', result: { baseFeePerGas: '0x2e90edd000' } }),
        ok: true,
        status: 200,
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    await (executor as unknown as EvmGasAccess).patchEvmGas(Chain.Base, payload)

    expect(payload.blockchainSpecific.value.priorityFee).toBe('2000000000')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('still establishes an EIP-1559 tip when the current base fee is zero', async () => {
    const payload = createEvmPayload()
    payload.blockchainSpecific.value.maxFeePerGasWei = '0'
    payload.blockchainSpecific.value.priorityFee = '0'
    const executor = new AgentExecutor(createSigningVault(payload))
    mockEvmFeeRpc(0n, 2_000_000_000n)

    await (executor as unknown as EvmGasAccess).patchEvmGas(Chain.Base, payload)

    expect(payload.blockchainSpecific.value.priorityFee).toBe('2000000000')
    expect(payload.blockchainSpecific.value.maxFeePerGasWei).toBe('2000000000')
  })

  it('leaves legacy BSC fee fields byte-untouched and skips all fee RPCs', async () => {
    const payload = createEvmPayload()
    payload.blockchainSpecific.value.maxFeePerGasWei = '0'
    payload.blockchainSpecific.value.priorityFee = '0'
    const executor = new AgentExecutor(createSigningVault(payload))
    const fetchMock = mockEvmFeeRpc(10_000_000_000n, 5_000_000_000n)

    await (executor as unknown as EvmGasAccess).patchEvmGas(Chain.BSC, payload)

    // Legacy maxFeePerGasWei is the signing mapper's gasPrice — a nonzero base
    // fee must never rewrite it through the EIP-1559 headroom formula.
    expect(payload.blockchainSpecific.value.priorityFee).toBe('0')
    expect(payload.blockchainSpecific.value.maxFeePerGasWei).toBe('0')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
