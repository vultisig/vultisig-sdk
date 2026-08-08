import type { VaultBase } from '@vultisig/sdk'
import { Chain, getEvmRpcUrl } from '@vultisig/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@vultisig/sdk', async () => {
  const actual = await vi.importActual<typeof import('@vultisig/sdk')>('@vultisig/sdk')

  return {
    ...actual,
    getEvmRpcUrl: vi.fn((chain: string) => `https://rpc.example/${chain.toLowerCase()}`),
  }
})

import { AgentExecutor } from '../executor'

function createMockVault(): VaultBase {
  return {
    name: 'mock-vault',
    id: 'vault-mock-1',
    type: 'secure',
    chains: [Chain.Ethereum, Chain.Base],
    isEncrypted: false,
    address: vi.fn().mockResolvedValue('0xsender'),
  } as unknown as VaultBase
}

describe('AgentExecutor EVM RPC resolution', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('uses the shared sdk getEvmRpcUrl resolver when refreshing EVM gas', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ result: { baseFeePerGas: '0xa' } }),
    }) as unknown as typeof fetch

    const executor = new AgentExecutor(createMockVault())
    const payload = {
      blockchainSpecific: {
        case: 'ethereumSpecific',
        value: { priorityFee: '2', maxFeePerGasWei: '10', gasLimit: '21000' },
      },
    }

    await (executor as unknown as { patchEvmGas: (chain: Chain, payload: unknown) => Promise<void> }).patchEvmGas(
      Chain.Base,
      payload
    )

    expect(vi.mocked(getEvmRpcUrl)).toHaveBeenCalledWith(Chain.Base)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://rpc.example/base',
      expect.objectContaining({ method: 'POST' })
    )
    expect(payload.blockchainSpecific.value.maxFeePerGasWei).toBe('27')
  })

  it('uses the shared sdk getEvmRpcUrl resolver when checking the pending nonce', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ result: '0x10' }),
    }) as unknown as typeof fetch

    const executor = new AgentExecutor(createMockVault())
    const nonce = await (
      executor as unknown as { fetchEvmPendingNonce: (chain: Chain) => Promise<bigint | null> }
    ).fetchEvmPendingNonce(Chain.Ethereum)

    expect(nonce).toBe(16n)
    expect(vi.mocked(getEvmRpcUrl)).toHaveBeenCalledWith(Chain.Ethereum)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://rpc.example/ethereum',
      expect.objectContaining({ method: 'POST' })
    )
  })
})