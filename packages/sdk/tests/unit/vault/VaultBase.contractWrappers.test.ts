import { Chain } from '@vultisig/core-chain/Chain'
import { encodeFunctionData, erc20Abi, hashTypedData } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEvmCall } = vi.hoisted(() => ({
  mockEvmCall: vi.fn(),
}))

vi.mock('@/tools/evm/evmCall', () => ({
  evmCall: mockEvmCall,
}))

import { MAX_UINT256 } from '@/tools/evm/encodeErc20Approve'
import { computeEip712Hash } from '@/utils/eip712'
import { VaultBase } from '@/vault/VaultBase'
import { VaultError, VaultErrorCode } from '@/vault/VaultError'

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const SPENDER = '0x1111111254EEB25477B68fb85Ed929f73A960582'

function makeVault(overrides: Record<string, unknown> = {}): VaultBase {
  const vault = Object.create(VaultBase.prototype) as VaultBase
  Object.assign(vault as object, {
    getTokens: () => [],
    ...overrides,
  })
  return vault
}

describe('VaultBase.approve', () => {
  it('rejects non-EVM chains', async () => {
    const vault = makeVault()
    await expect(
      vault.approve({ chain: Chain.Bitcoin, token: 'USDC', spender: SPENDER, amount: '1' })
    ).rejects.toMatchObject({ code: VaultErrorCode.ChainNotSupported })
  })

  it('rejects a native-asset approve', async () => {
    const vault = makeVault()
    await expect(
      vault.approve({ chain: Chain.Ethereum, token: 'ETH', spender: SPENDER, amount: '1' })
    ).rejects.toBeInstanceOf(VaultError)
  })

  it('delegates an ERC-20 approve to contractCall with the resolved USDC contract', async () => {
    const contractCall = vi.fn().mockResolvedValue({ dryRun: true, keysignPayload: { __mock: true } })
    const vault = makeVault({ contractCall })

    await vault.approve({
      chain: Chain.Ethereum,
      token: 'USDC',
      spender: SPENDER,
      amount: '1',
      dryRun: true,
    })

    expect(contractCall).toHaveBeenCalledWith({
      chain: Chain.Ethereum,
      contractAddress: USDC,
      abi: erc20Abi,
      functionName: 'approve',
      args: [SPENDER, 1_000_000n],
      dryRun: true,
    })
  })

  it('passes uint256 max when amount is "max"', async () => {
    const contractCall = vi.fn().mockResolvedValue({ dryRun: true, keysignPayload: { __mock: true } })
    const vault = makeVault({ contractCall })

    await vault.approve({
      chain: Chain.Ethereum,
      token: 'USDC',
      spender: SPENDER,
      amount: 'max',
    })

    expect(contractCall).toHaveBeenCalledWith(expect.objectContaining({ args: [SPENDER, MAX_UINT256] }))
  })
})

describe('VaultBase.readContract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects non-EVM chains', async () => {
    const vault = makeVault()
    await expect(
      vault.readContract({
        chain: Chain.Bitcoin,
        contract: USDC,
        abi: erc20Abi,
        functionName: 'decimals',
      })
    ).rejects.toMatchObject({ code: VaultErrorCode.ChainNotSupported })
  })

  it('encodes the call, hits evmCall, and decodes the result', async () => {
    mockEvmCall.mockResolvedValue(('0x' + 6n.toString(16).padStart(64, '0')) as `0x${string}`)
    const vault = makeVault()

    const result = await vault.readContract({
      chain: Chain.Ethereum,
      contract: USDC,
      abi: erc20Abi,
      functionName: 'decimals',
    })

    expect(result).toBe(6)
    expect(mockEvmCall).toHaveBeenCalledWith(Chain.Ethereum, {
      to: USDC,
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'decimals' }),
    })
  })
})

describe('VaultBase.signTypedData', () => {
  const domain = {
    name: 'USD Coin',
    version: '2',
    chainId: 1,
    verifyingContract: USDC,
  } as const
  const types = {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  }
  const message = {
    owner: '0x0000000000000000000000000000000000000001',
    spender: SPENDER,
    value: 1n,
    nonce: 0n,
    deadline: 1n,
  }

  it('rejects non-EVM chains', async () => {
    const vault = makeVault()
    await expect(
      vault.signTypedData({
        chain: Chain.Bitcoin,
        domain,
        types,
        primaryType: 'Permit',
        message,
      })
    ).rejects.toMatchObject({ code: VaultErrorCode.ChainNotSupported })
  })

  it('signs the viem EIP-712 digest and returns a 65-byte signature', async () => {
    const r = '11'.repeat(32)
    const s = '22'.repeat(32)
    const signBytes = vi.fn().mockResolvedValue({ signature: r + s, recovery: 0, format: 'ECDSA' })
    const vault = makeVault({ signBytes })

    const result = await vault.signTypedData({
      chain: Chain.Ethereum,
      domain,
      types,
      primaryType: 'Permit',
      message,
    })

    const expectedHash = computeEip712Hash(domain, types, 'Permit', message)
    expect(expectedHash).toBe(
      hashTypedData({
        domain,
        types,
        primaryType: 'Permit',
        message,
      })
    )
    expect(signBytes).toHaveBeenCalledWith({ data: expectedHash, chain: Chain.Ethereum }, undefined)
    expect(result.hash).toBe(expectedHash)
    expect(result.signature).toBe(`0x${r}${s}1b`)
    expect(result.v).toBe(27)
    expect(result.r).toBe(`0x${r}`)
    expect(result.s).toBe(`0x${s}`)
    expect(result.chain).toBe(Chain.Ethereum)
  })
})
