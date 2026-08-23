import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockBuildSendKeysignPayload, mockGetPublicKey, mockGetWalletCore, mockIsValidAddress } = vi.hoisted(() => ({
  mockBuildSendKeysignPayload: vi.fn(),
  mockGetPublicKey: vi.fn(),
  mockGetWalletCore: vi.fn(),
  mockIsValidAddress: vi.fn(),
}))

vi.mock('@vultisig/core-mpc/keysign/send/build', () => ({
  buildSendKeysignPayload: mockBuildSendKeysignPayload,
}))
vi.mock('@vultisig/core-chain/publicKey/getPublicKey', () => ({
  getPublicKey: mockGetPublicKey,
}))
vi.mock('@vultisig/core-chain/utils/isValidAddress', () => ({
  isValidAddress: mockIsValidAddress,
}))
vi.mock('@/context/wasmRuntime', () => ({
  getWalletCore: mockGetWalletCore,
}))

import { prepareRawEvmTxFromKeys } from '@/tools/prep/rawEvm'
import type { VaultIdentity } from '@/tools/prep/types'

const identity: VaultIdentity = {
  ecdsaPublicKey: '02ecdsa-public-key',
  eddsaPublicKey: 'eddsa-public-key',
  hexChainCode: 'deadbeef',
  localPartyId: 'iPhone-A1B2',
  libType: 'DKLS',
}

const senderAddress = '0x000000000000000000000000000000000000abcd'
const contractAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

const makePayload = () => ({
  blockchainSpecific: {
    case: 'ethereumSpecific' as const,
    value: {
      gasLimit: '21000',
      maxFeePerGasWei: '2000000000',
      nonce: 1n,
      priorityFee: '1000000000',
    },
  },
})

describe('prepareRawEvmTxFromKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWalletCore.mockResolvedValue({ __mock: 'walletCore' })
    mockGetPublicKey.mockReturnValue({ __mock: 'publicKey' })
    mockIsValidAddress.mockReturnValue(true)
    mockBuildSendKeysignPayload.mockImplementation(async () => makePayload())
  })

  it('builds a zero-value contract call and applies every explicit envelope field', async () => {
    const payload = await prepareRawEvmTxFromKeys(identity, {
      chain: Chain.Ethereum,
      senderAddress,
      tx: {
        to: contractAddress,
        value: '0',
        data: '0x095ea7b3',
        gasLimit: '60000',
        maxFeePerGas: '3000000000',
        maxPriorityFeePerGas: '1500000000',
        nonce: '7',
      },
    })

    expect(mockBuildSendKeysignPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 0n,
        receiver: contractAddress,
        memo: '0x095ea7b3',
      })
    )
    expect(payload.blockchainSpecific).toEqual({
      case: 'ethereumSpecific',
      value: {
        gasLimit: '60000',
        maxFeePerGasWei: '3000000000',
        nonce: 7n,
        priorityFee: '1500000000',
      },
    })
  })

  it('preserves a value-bearing raw call and accepts 0x-prefixed integers', async () => {
    await prepareRawEvmTxFromKeys(identity, {
      chain: Chain.Polygon,
      senderAddress,
      tx: {
        to: contractAddress,
        value: '0xde0b6b3a7640000',
        data: '0xd0e30db0',
        gasLimit: '0x5208',
        nonce: 0,
      },
    })

    expect(mockBuildSendKeysignPayload).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1_000_000_000_000_000_000n, memo: '0xd0e30db0' })
    )
  })

  it('rejects non-EVM chains before loading WalletCore', async () => {
    await expect(
      prepareRawEvmTxFromKeys(identity, {
        chain: Chain.Bitcoin,
        senderAddress,
        tx: { to: contractAddress },
      })
    ).rejects.toThrow('prepareRawEvmTxFromKeys only supports EVM chains')
    expect(mockGetWalletCore).not.toHaveBeenCalled()
  })

  it('rejects malformed calldata and contradictory fee fields', async () => {
    await expect(
      prepareRawEvmTxFromKeys(identity, {
        chain: Chain.Ethereum,
        senderAddress,
        tx: { to: contractAddress, data: '0xabc' },
      })
    ).rejects.toThrow('data must be an even-length 0x-prefixed hex string')

    await expect(
      prepareRawEvmTxFromKeys(identity, {
        chain: Chain.Ethereum,
        senderAddress,
        tx: { to: contractAddress, maxFeePerGas: 1n, maxPriorityFeePerGas: 2n },
      })
    ).rejects.toThrow('maxFeePerGas cannot be lower than maxPriorityFeePerGas')
  })
})
