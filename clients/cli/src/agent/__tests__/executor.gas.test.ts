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
    expect(fetchMock).toHaveBeenCalledWith(
      'https://ethereum-rpc.publicnode.com',
      expect.objectContaining({ method: 'POST' })
    )
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
    expect(fetchMock).toHaveBeenCalledWith(
      'https://ethereum-rpc.publicnode.com',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('warns without verbose and signs with the original estimate after a malformed base fee', async () => {
    const payload = createEvmPayload()
    const vault = createSigningVault(payload)
    const executor = new AgentExecutor(vault)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        jsonrpc: '2.0',
        result: { baseFeePerGas: '' },
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
    expect(fetchMock).toHaveBeenCalledWith(
      'https://ethereum-rpc.publicnode.com',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('silently keeps the original estimate when BSC reports a legitimate zero base fee', async () => {
    const payload = createEvmPayload()
    payload.blockchainSpecific.value.maxFeePerGasWei = '500000000'
    const vault = createSigningVault(payload)
    const executor = new AgentExecutor(vault)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        jsonrpc: '2.0',
        result: { baseFeePerGas: '0x0' },
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
      'https://bsc-dataseed.binance.org',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it.each([
    [Chain.Ethereum, 'https://ethereum-rpc.publicnode.com'],
    [Chain.Polygon, 'https://polygon-bor-rpc.publicnode.com'],
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
