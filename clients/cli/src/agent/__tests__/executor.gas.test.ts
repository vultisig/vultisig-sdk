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
    clearEvmState: ReturnType<typeof vi.fn>
    getNextEvmNonce: ReturnType<typeof vi.fn>
  }
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
    clearEvmState: vi.fn(),
    getNextEvmNonce: vi.fn().mockReturnValue(nextNonce),
  }
  return access
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('AgentExecutor raw EVM envelope preparation', () => {
  it('passes the raw transaction fields to the SDK helper without post-build RPC mutation', async () => {
    const payload = createEvmPayload()
    const vault = createSigningVault(payload)
    const executor = new AgentExecutor(vault)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

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
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves value-bearing camelCase main-call fields through sign and broadcast', async () => {
    const payload = createEvmPayload()
    const vault = createSigningVault(payload)
    const executor = new AgentExecutor(vault)

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
