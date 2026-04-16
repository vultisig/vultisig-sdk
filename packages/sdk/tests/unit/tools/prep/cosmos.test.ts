import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockBuildSignAminoKeysignPayload, mockBuildSignDirectKeysignPayload, mockGetPublicKey, mockGetWalletCore } =
  vi.hoisted(() => ({
    mockBuildSignAminoKeysignPayload: vi.fn(),
    mockBuildSignDirectKeysignPayload: vi.fn(),
    mockGetPublicKey: vi.fn(),
    mockGetWalletCore: vi.fn(),
  }))

vi.mock('@/vault/services/cosmos/buildCosmosPayload', () => ({
  buildSignAminoKeysignPayload: mockBuildSignAminoKeysignPayload,
  buildSignDirectKeysignPayload: mockBuildSignDirectKeysignPayload,
}))
vi.mock('@vultisig/core-chain/publicKey/getPublicKey', () => ({
  getPublicKey: mockGetPublicKey,
}))
vi.mock('@/context/wasmRuntime', () => ({
  getWalletCore: mockGetWalletCore,
}))

import { prepareSignAminoTxFromKeys, prepareSignDirectTxFromKeys } from '@/tools/prep/cosmos'
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

const cosmosCoin = {
  chain: Chain.Cosmos,
  address: 'cosmos1abcdef',
  decimals: 6,
  ticker: 'ATOM',
} as any

describe('prepareSignAminoTxFromKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWalletCore.mockResolvedValue(mockWalletCore)
    mockGetPublicKey.mockReturnValue(mockPublicKey)
    mockBuildSignAminoKeysignPayload.mockResolvedValue(mockPayload)
  })

  it('builds a SignAmino payload for a governance vote and forwards identity fields', async () => {
    const input = {
      chain: Chain.Cosmos,
      coin: cosmosCoin,
      msgs: [
        {
          type: 'cosmos-sdk/MsgVote',
          value: JSON.stringify({
            proposal_id: '123',
            voter: 'cosmos1abcdef',
            option: 'VOTE_OPTION_YES',
          }),
        },
      ],
      fee: {
        amount: [{ denom: 'uatom', amount: '5000' }],
        gas: '200000',
      },
    } as any

    const result = await prepareSignAminoTxFromKeys(baseIdentity, input, {
      skipChainSpecificFetch: true,
    })

    expect(result).toBe(mockPayload)

    expect(mockGetPublicKey).toHaveBeenCalledTimes(1)
    expect(mockGetPublicKey).toHaveBeenCalledWith({
      chain: Chain.Cosmos,
      walletCore: mockWalletCore,
      publicKeys: {
        ecdsa: baseIdentity.ecdsaPublicKey,
        eddsa: baseIdentity.eddsaPublicKey,
      },
      hexChainCode: baseIdentity.hexChainCode,
    })

    expect(mockBuildSignAminoKeysignPayload).toHaveBeenCalledTimes(1)
    const call = mockBuildSignAminoKeysignPayload.mock.calls[0][0]

    expect(call).toMatchObject({
      chain: Chain.Cosmos,
      coin: cosmosCoin,
      msgs: input.msgs,
      fee: input.fee,
      vaultId: baseIdentity.ecdsaPublicKey,
      localPartyId: baseIdentity.localPartyId,
      libType: baseIdentity.libType,
      publicKey: mockPublicKey,
      skipChainSpecificFetch: true,
    })
  })

  it('rejects non-Cosmos chain (Ethereum)', async () => {
    await expect(
      prepareSignAminoTxFromKeys(baseIdentity, {
        chain: Chain.Ethereum,
        coin: cosmosCoin,
        msgs: [],
        fee: { amount: [], gas: '0' },
      } as any)
    ).rejects.toThrow('Chain Ethereum does not support SignAmino. Use a Cosmos-SDK chain.')

    expect(mockBuildSignAminoKeysignPayload).not.toHaveBeenCalled()
    expect(mockGetWalletCore).not.toHaveBeenCalled()
  })
})

describe('prepareSignDirectTxFromKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWalletCore.mockResolvedValue(mockWalletCore)
    mockGetPublicKey.mockReturnValue(mockPublicKey)
    mockBuildSignDirectKeysignPayload.mockResolvedValue(mockPayload)
  })

  it('builds a SignDirect payload for a custom protobuf tx and forwards identity fields', async () => {
    const input = {
      chain: Chain.Cosmos,
      coin: cosmosCoin,
      bodyBytes: 'base64BodyBytes',
      authInfoBytes: 'base64AuthInfoBytes',
      chainId: 'cosmoshub-4',
      accountNumber: '12345',
    } as any

    const result = await prepareSignDirectTxFromKeys(baseIdentity, input, {
      skipChainSpecificFetch: true,
    })

    expect(result).toBe(mockPayload)

    expect(mockGetPublicKey).toHaveBeenCalledTimes(1)
    expect(mockGetPublicKey).toHaveBeenCalledWith({
      chain: Chain.Cosmos,
      walletCore: mockWalletCore,
      publicKeys: {
        ecdsa: baseIdentity.ecdsaPublicKey,
        eddsa: baseIdentity.eddsaPublicKey,
      },
      hexChainCode: baseIdentity.hexChainCode,
    })

    expect(mockBuildSignDirectKeysignPayload).toHaveBeenCalledTimes(1)
    const call = mockBuildSignDirectKeysignPayload.mock.calls[0][0]

    expect(call).toMatchObject({
      chain: Chain.Cosmos,
      coin: cosmosCoin,
      bodyBytes: 'base64BodyBytes',
      authInfoBytes: 'base64AuthInfoBytes',
      chainId: 'cosmoshub-4',
      accountNumber: '12345',
      vaultId: baseIdentity.ecdsaPublicKey,
      localPartyId: baseIdentity.localPartyId,
      libType: baseIdentity.libType,
      publicKey: mockPublicKey,
      skipChainSpecificFetch: true,
    })
  })

  it('rejects non-Cosmos chain (Ethereum)', async () => {
    await expect(
      prepareSignDirectTxFromKeys(baseIdentity, {
        chain: Chain.Ethereum,
        coin: cosmosCoin,
        bodyBytes: '',
        authInfoBytes: '',
        chainId: 'cosmoshub-4',
        accountNumber: '0',
      } as any)
    ).rejects.toThrow('Chain Ethereum does not support SignDirect. Use a Cosmos-SDK chain.')

    expect(mockBuildSignDirectKeysignPayload).not.toHaveBeenCalled()
    expect(mockGetWalletCore).not.toHaveBeenCalled()
  })

  it('uses the explicit walletCore override and does not call the global getWalletCore', async () => {
    const overrideWalletCore = { __mock: 'override-walletCore' }
    mockBuildSignDirectKeysignPayload.mockResolvedValue(mockPayload)

    await prepareSignDirectTxFromKeys(
      baseIdentity,
      {
        chain: Chain.Cosmos,
        coin: cosmosCoin,
        bodyBytes: 'base64BodyBytes',
        authInfoBytes: 'base64AuthInfoBytes',
        chainId: 'cosmoshub-4',
        accountNumber: '12345',
      } as any,
      undefined,
      overrideWalletCore as any
    )

    expect(mockGetWalletCore).not.toHaveBeenCalled()
    expect(mockGetPublicKey).toHaveBeenCalledWith(expect.objectContaining({ walletCore: overrideWalletCore }))
  })
})
