import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockBuildSendKeysignPayload, mockGetPublicKey, mockGetWalletCore } = vi.hoisted(() => ({
  mockBuildSendKeysignPayload: vi.fn(),
  mockGetPublicKey: vi.fn(),
  mockGetWalletCore: vi.fn(),
}))

vi.mock('@vultisig/core-mpc/keysign/send/build', () => ({
  buildSendKeysignPayload: mockBuildSendKeysignPayload,
}))
vi.mock('@vultisig/core-chain/publicKey/getPublicKey', () => ({
  getPublicKey: mockGetPublicKey,
}))
vi.mock('@/context/wasmRuntime', () => ({
  getWalletCore: mockGetWalletCore,
}))

import { prepareContractCallTxFromKeys } from '@/tools/prep/contractCall'
import type { VaultIdentity } from '@/tools/prep/types'

const baseIdentity: VaultIdentity = {
  ecdsaPublicKey: '02ecdsa-public-key',
  eddsaPublicKey: 'eddsa-public-key',
  hexChainCode: 'deadbeef',
  localPartyId: 'iPhone-A1B2',
  libType: 'DKLS',
}

const mockWalletCore = { __mock: 'walletCore' }
const mockPublicKey = { __mock: 'publicKey' }
const mockPayload = { __mock: 'payload' }

const erc20ApproveAbi = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

const wethDepositAbi = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
] as const

const senderAddress = '0x000000000000000000000000000000000000abcd'
const contractAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const spenderAddress = '0xC5d563A36AE78145C45a50134d48A1215220f80a'

describe('prepareContractCallTxFromKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWalletCore.mockResolvedValue(mockWalletCore)
    mockGetPublicKey.mockReturnValue(mockPublicKey)
    mockBuildSendKeysignPayload.mockResolvedValue(mockPayload)
  })

  it('encodes ABI calldata and builds a zero-value send for an EVM token approval', async () => {
    const result = await prepareContractCallTxFromKeys(baseIdentity, {
      chain: Chain.Ethereum,
      contractAddress,
      abi: erc20ApproveAbi,
      functionName: 'approve',
      args: [spenderAddress, 1_000n],
      senderAddress,
    })

    expect(result).toBe(mockPayload)

    expect(mockGetPublicKey).toHaveBeenCalledTimes(1)
    expect(mockGetPublicKey).toHaveBeenCalledWith({
      chain: Chain.Ethereum,
      walletCore: mockWalletCore,
      publicKeys: {
        ecdsa: baseIdentity.ecdsaPublicKey,
        eddsa: baseIdentity.eddsaPublicKey,
      },
      hexChainCode: baseIdentity.hexChainCode,
    })

    expect(mockBuildSendKeysignPayload).toHaveBeenCalledTimes(1)
    const call = mockBuildSendKeysignPayload.mock.calls[0][0]

    expect(call).toMatchObject({
      receiver: contractAddress,
      amount: 0n,
      vaultId: baseIdentity.ecdsaPublicKey,
      localPartyId: baseIdentity.localPartyId,
      libType: baseIdentity.libType,
      publicKey: mockPublicKey,
      walletCore: mockWalletCore,
    })

    // Native fee coin from chainFeeCoin[Ethereum]
    expect(call.coin).toMatchObject({
      chain: Chain.Ethereum,
      address: senderAddress,
      ticker: 'ETH',
      decimals: 18,
    })

    // ABI-encoded calldata: approve(address,uint256)
    expect(typeof call.memo).toBe('string')
    expect(call.memo).toMatch(/^0x095ea7b3/)
  })

  it('passes through value for a value-bearing call (WETH deposit)', async () => {
    await prepareContractCallTxFromKeys(baseIdentity, {
      chain: Chain.Ethereum,
      contractAddress,
      abi: wethDepositAbi,
      functionName: 'deposit',
      value: 2_500_000_000_000_000_000n,
      senderAddress,
    })

    expect(mockBuildSendKeysignPayload).toHaveBeenCalledTimes(1)
    const call = mockBuildSendKeysignPayload.mock.calls[0][0]

    expect(call.amount).toBe(2_500_000_000_000_000_000n)
    expect(call.receiver).toBe(contractAddress)
    // deposit() selector
    expect(call.memo).toBe('0xd0e30db0')
  })

  it('rejects non-EVM chains (Bitcoin)', async () => {
    await expect(
      prepareContractCallTxFromKeys(baseIdentity, {
        chain: Chain.Bitcoin,
        contractAddress,
        abi: erc20ApproveAbi,
        functionName: 'approve',
        args: [spenderAddress, 1n],
        senderAddress,
      })
    ).rejects.toThrow('prepareContractCallTxFromKeys only supports EVM chains. Got: Bitcoin')

    expect(mockBuildSendKeysignPayload).not.toHaveBeenCalled()
    expect(mockGetWalletCore).not.toHaveBeenCalled()
  })

  it('rejects negative value', async () => {
    await expect(
      prepareContractCallTxFromKeys(baseIdentity, {
        chain: Chain.Ethereum,
        contractAddress,
        abi: erc20ApproveAbi,
        functionName: 'approve',
        args: [spenderAddress, 1n],
        value: -1n,
        senderAddress,
      })
    ).rejects.toThrow('Contract call value cannot be negative')

    expect(mockBuildSendKeysignPayload).not.toHaveBeenCalled()
  })

  it('uses the explicit walletCore override and does not call the global getWalletCore', async () => {
    const overrideWalletCore = { __mock: 'override-walletCore' }

    await prepareContractCallTxFromKeys(
      baseIdentity,
      {
        chain: Chain.Ethereum,
        contractAddress,
        abi: erc20ApproveAbi,
        functionName: 'approve',
        args: [spenderAddress, 1n],
        senderAddress,
      },
      overrideWalletCore as any
    )

    expect(mockGetWalletCore).not.toHaveBeenCalled()
    expect(mockBuildSendKeysignPayload.mock.calls[0][0].walletCore).toBe(overrideWalletCore)
  })

  it('forwards identity fields (vaultId, localPartyId, libType) to buildSendKeysignPayload', async () => {
    const identity: VaultIdentity = {
      ...baseIdentity,
      ecdsaPublicKey: '03custom-ecdsa',
      localPartyId: 'Pixel-99',
      libType: 'GG20',
    }

    await prepareContractCallTxFromKeys(identity, {
      chain: Chain.Polygon,
      contractAddress,
      abi: erc20ApproveAbi,
      functionName: 'approve',
      args: [spenderAddress, 5n],
      senderAddress,
    })

    expect(mockBuildSendKeysignPayload).toHaveBeenCalledTimes(1)
    const call = mockBuildSendKeysignPayload.mock.calls[0][0]

    expect(call.vaultId).toBe(identity.ecdsaPublicKey)
    expect(call.localPartyId).toBe(identity.localPartyId)
    expect(call.libType).toBe(identity.libType)
    // Polygon native is POL/MATIC (decimals 18) per chainFeeCoin
    expect(call.coin.chain).toBe(Chain.Polygon)
    expect(call.coin.decimals).toBe(18)
  })
})
