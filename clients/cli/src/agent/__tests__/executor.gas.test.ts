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
    prepareSendTx: vi.fn().mockResolvedValue(payload),
    extractMessageHashes: vi.fn().mockResolvedValue(['0xmessage']),
    sign: vi.fn().mockResolvedValue({ r: '0xr', s: '0xs', recoveryId: 0 }),
    broadcastTx: vi.fn().mockResolvedValue('0xtxhash'),
  } as unknown as VaultBase
}

function serverTransaction(chain: Chain) {
  return {
    chain,
    send_tx: {
      data: '0x',
      to: '0xrecipient',
      value: '1',
    },
  }
}

async function signEvm(executor: AgentExecutor, chain: Chain) {
  return (executor as unknown as EvmSigner).signEvmServerTx(serverTransaction(chain), chain, {})
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

describe('AgentExecutor EVM gas refresh', () => {
  it('warns without verbose and signs with the original estimate after an HTTP failure', async () => {
    const payload = createEvmPayload()
    const vault = createSigningVault(payload)
    const executor = new AgentExecutor(vault)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    // Keep a valid-looking result so the HTTP status remains the only failure signal.
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        jsonrpc: '2.0',
        result: { baseFeePerGas: '0x3b9aca00' },
      }),
      ok: false,
      status: 521,
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await signEvm(executor, Chain.Ethereum)

    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('gas estimate was not refreshed for Ethereum'))
    expect(payload.blockchainSpecific.value.maxFeePerGasWei).toBe('2000000000')
    expect(vault.sign).toHaveBeenCalledOnce()
    expect(vault.broadcastTx).toHaveBeenCalledOnce()
    expect(result.tx_hash).toBe('0xtxhash')
    expect(fetchMock).toHaveBeenCalledWith('https://api.vultisig.com/eth/', expect.objectContaining({ method: 'POST' }))
  })

  it('warns without verbose and signs with the original estimate after an HTTP-200 JSON-RPC error', async () => {
    const payload = createEvmPayload()
    const vault = createSigningVault(payload)
    const executor = new AgentExecutor(vault)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    // Keep a valid-looking result so the JSON-RPC error remains the only failure signal.
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        error: { code: -32051, message: 'tenant disabled' },
        jsonrpc: '2.0',
        result: { baseFeePerGas: '0x3b9aca00' },
      }),
      ok: true,
      status: 200,
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await signEvm(executor, Chain.Ethereum)

    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('gas estimate was not refreshed for Ethereum'))
    expect(payload.blockchainSpecific.value.maxFeePerGasWei).toBe('2000000000')
    expect(vault.sign).toHaveBeenCalledOnce()
    expect(vault.broadcastTx).toHaveBeenCalledOnce()
    expect(result.tx_hash).toBe('0xtxhash')
    expect(fetchMock).toHaveBeenCalledWith('https://api.vultisig.com/eth/', expect.objectContaining({ method: 'POST' }))
  })

  it('warns without verbose and signs with the original estimate when the base fee is absent', async () => {
    const payload = createEvmPayload()
    const vault = createSigningVault(payload)
    const executor = new AgentExecutor(vault)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        jsonrpc: '2.0',
        result: {},
      }),
      ok: true,
      status: 200,
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await signEvm(executor, Chain.Ethereum)

    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('gas estimate was not refreshed for Ethereum'))
    expect(payload.blockchainSpecific.value.maxFeePerGasWei).toBe('2000000000')
    expect(vault.sign).toHaveBeenCalledOnce()
    expect(vault.broadcastTx).toHaveBeenCalledOnce()
    expect(result.tx_hash).toBe('0xtxhash')
    expect(fetchMock).toHaveBeenCalledWith('https://api.vultisig.com/eth/', expect.objectContaining({ method: 'POST' }))
  })

  it.each([
    ['hex string', '0x0'],
    ['JSON number', 0],
  ])(
    'silently keeps the original estimate when BSC reports a legitimate zero base fee as a %s',
    async (_representation, baseFeePerGas) => {
      const payload = createEvmPayload()
      payload.blockchainSpecific.value.maxFeePerGasWei = '500000000'
      const vault = createSigningVault(payload)
      const executor = new AgentExecutor(vault)
      const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
      const fetchMock = vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          jsonrpc: '2.0',
          result: { baseFeePerGas },
        }),
        ok: true,
        status: 200,
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await signEvm(executor, Chain.BSC)

      expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining('gas estimate was not refreshed'))
      expect(payload.blockchainSpecific.value.maxFeePerGasWei).toBe('500000000')
      expect(vault.sign).toHaveBeenCalledOnce()
      expect(vault.broadcastTx).toHaveBeenCalledOnce()
      expect(result.tx_hash).toBe('0xtxhash')
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.vultisig.com/bsc/',
        expect.objectContaining({ method: 'POST' })
      )
    }
  )

  // These successful-refresh cases pin the endpoint URLs; behavioural coverage lives in the cases above.
  // The literals are the canonical `getEvmRpcUrl` values (packages/core/chain/chains/evm/chainInfo.ts),
  // spelled out rather than computed so a silent map change fails here instead of asserting itself.
  it.each([
    [Chain.Ethereum, 'https://api.vultisig.com/eth/'],
    [Chain.Polygon, 'https://api.vultisig.com/polygon/'],
  ])('does not warn after a successful %s gas refresh', async (chain, rpcUrl) => {
    const payload = createEvmPayload()
    const vault = createSigningVault(payload)
    const executor = new AgentExecutor(vault)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        jsonrpc: '2.0',
        result: { baseFeePerGas: '0x3b9aca00' },
      }),
      ok: true,
      status: 200,
    })
    vi.stubGlobal('fetch', fetchMock)

    await signEvm(executor, chain)

    expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining('gas estimate was not refreshed'))
    expect(payload.blockchainSpecific.value.maxFeePerGasWei).toBe('3500000000')
    expect(vault.sign).toHaveBeenCalledOnce()
    expect(vault.broadcastTx).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(rpcUrl, expect.objectContaining({ method: 'POST' }))
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
