import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockBuildSendKeysignPayload, mockGetPublicKey, mockIsValidAddress, mockGetWalletCore } = vi.hoisted(() => ({
  mockBuildSendKeysignPayload: vi.fn(),
  mockGetPublicKey: vi.fn(),
  mockIsValidAddress: vi.fn(),
  mockGetWalletCore: vi.fn(),
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

import { prepareSendTxFromKeys } from '@/tools/prep/send'
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

describe('prepareSendTxFromKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWalletCore.mockResolvedValue(mockWalletCore)
    mockIsValidAddress.mockReturnValue(true)
    mockGetPublicKey.mockReturnValue(mockPublicKey)
    mockBuildSendKeysignPayload.mockResolvedValue(mockPayload)
  })

  it('passes identity through for an ECDSA chain (Ethereum)', async () => {
    const result = await prepareSendTxFromKeys(baseIdentity, {
      coin: {
        chain: Chain.Ethereum,
        address: '0xfrom',
        decimals: 18,
        ticker: 'ETH',
      } as any,
      receiver: '0xto',
      amount: 1_000_000_000_000_000_000n,
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
      vaultId: baseIdentity.ecdsaPublicKey,
      localPartyId: baseIdentity.localPartyId,
      libType: baseIdentity.libType,
      publicKey: mockPublicKey,
      hexPublicKeyOverride: undefined,
      walletCore: mockWalletCore,
      receiver: '0xto',
      amount: 1_000_000_000_000_000_000n,
    })
  })

  it('passes publicKey: null and hexPublicKeyOverride for QBTC (MLDSA chain)', async () => {
    const identity: VaultIdentity = {
      ...baseIdentity,
      publicKeyMldsa: 'mldsa-pubkey-hex',
    }

    await prepareSendTxFromKeys(identity, {
      coin: {
        chain: Chain.QBTC,
        address: 'qbtc-from',
        decimals: 8,
        ticker: 'QBTC',
      } as any,
      receiver: 'qbtc-to',
      amount: 100n,
    })

    expect(mockGetPublicKey).not.toHaveBeenCalled()
    expect(mockBuildSendKeysignPayload).toHaveBeenCalledTimes(1)
    const call = mockBuildSendKeysignPayload.mock.calls[0][0]
    expect(call.publicKey).toBeNull()
    expect(call.hexPublicKeyOverride).toBe('mldsa-pubkey-hex')
    expect(call.vaultId).toBe(identity.ecdsaPublicKey)
    expect(call.localPartyId).toBe(identity.localPartyId)
    expect(call.libType).toBe(identity.libType)
  })

  it('passes through unchanged for Bitcoin (UTXO refinement happens inside core)', async () => {
    const result = await prepareSendTxFromKeys(baseIdentity, {
      coin: {
        chain: Chain.Bitcoin,
        address: 'bc1from',
        decimals: 8,
        ticker: 'BTC',
      } as any,
      receiver: 'bc1to',
      amount: 50_000n,
      memo: 'hello',
    })

    expect(result).toBe(mockPayload)

    expect(mockGetPublicKey).toHaveBeenCalledTimes(1)
    expect(mockBuildSendKeysignPayload).toHaveBeenCalledTimes(1)
    const call = mockBuildSendKeysignPayload.mock.calls[0][0]
    expect(call).toMatchObject({
      receiver: 'bc1to',
      amount: 50_000n,
      memo: 'hello',
      publicKey: mockPublicKey,
      hexPublicKeyOverride: undefined,
      vaultId: baseIdentity.ecdsaPublicKey,
      localPartyId: baseIdentity.localPartyId,
      libType: baseIdentity.libType,
    })
  })

  it('rejects when amount is zero', async () => {
    await expect(
      prepareSendTxFromKeys(baseIdentity, {
        coin: {
          chain: Chain.Ethereum,
          address: '0xfrom',
          decimals: 18,
          ticker: 'ETH',
        } as any,
        receiver: '0xto',
        amount: 0n,
      })
    ).rejects.toThrow('Amount must be greater than zero')

    expect(mockBuildSendKeysignPayload).not.toHaveBeenCalled()
  })

  it('rejects when receiver address is invalid', async () => {
    mockIsValidAddress.mockReturnValue(false)

    await expect(
      prepareSendTxFromKeys(baseIdentity, {
        coin: {
          chain: Chain.Ethereum,
          address: '0xfrom',
          decimals: 18,
          ticker: 'ETH',
        } as any,
        receiver: 'not-an-address',
        amount: 1n,
      })
    ).rejects.toThrow('Invalid receiver address for chain Ethereum: not-an-address')

    expect(mockBuildSendKeysignPayload).not.toHaveBeenCalled()
  })

  it('uses the explicit walletCore override and does not call the global getWalletCore', async () => {
    const overrideWalletCore = { __mock: 'override-walletCore' }

    await prepareSendTxFromKeys(
      baseIdentity,
      {
        coin: {
          chain: Chain.Ethereum,
          address: '0xfrom',
          decimals: 18,
          ticker: 'ETH',
        } as any,
        receiver: '0xto',
        amount: 1n,
      },
      overrideWalletCore as any
    )

    expect(mockGetWalletCore).not.toHaveBeenCalled()
    expect(mockBuildSendKeysignPayload.mock.calls[0][0].walletCore).toBe(overrideWalletCore)
  })

  it('rejects QBTC send when identity.publicKeyMldsa is missing', async () => {
    await expect(
      prepareSendTxFromKeys(baseIdentity, {
        coin: {
          chain: Chain.QBTC,
          address: 'qbtc-from',
          decimals: 8,
          ticker: 'QBTC',
        } as any,
        receiver: 'qbtc-to',
        amount: 100n,
      })
    ).rejects.toThrow('Vault MLDSA public key required for QBTC send')

    expect(mockBuildSendKeysignPayload).not.toHaveBeenCalled()
  })

  it('forwards chainPublicKeys to getPublicKey (seedphrase-imported vault)', async () => {
    const identity: VaultIdentity = {
      ...baseIdentity,
      chainPublicKeys: {
        [Chain.Ethereum]: '03per-chain-ecdsa',
      },
    }

    await prepareSendTxFromKeys(identity, {
      coin: {
        chain: Chain.Ethereum,
        address: '0xfrom',
        decimals: 18,
        ticker: 'ETH',
      } as any,
      receiver: '0xto',
      amount: 1_000_000_000_000_000_000n,
    })

    expect(mockGetPublicKey).toHaveBeenCalledWith(
      expect.objectContaining({
        chainPublicKeys: identity.chainPublicKeys,
      })
    )
  })
})
