import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock core functions - must be before imports
vi.mock('@vultisig/core-chain/publicKey/getPublicKey', () => ({
  getPublicKey: vi.fn(() => ({
    data: vi.fn().mockReturnValue(new Uint8Array(33)),
  })),
}))

vi.mock('@vultisig/core-mpc/keysign/send/build', () => ({
  buildSendKeysignPayload: vi.fn(),
}))

vi.mock('@vultisig/core-mpc/keysign/send/getSendFeeEstimate', () => ({
  getSendFeeEstimate: vi.fn(),
}))

vi.mock('@vultisig/core-chain/utils/isValidAddress', () => ({
  isValidAddress: vi.fn().mockReturnValue(true),
}))

vi.mock('@vultisig/core-chain/publicKey/tw/getTwPublicKeyType', () => ({
  getTwPublicKeyType: vi.fn(),
}))

vi.mock('@vultisig/core-mpc/tx/preSigningHashes', () => ({
  getPreSigningHashes: vi.fn(),
}))

vi.mock('@vultisig/core-mpc/keysign/signingInputs', () => ({
  getEncodedSigningInputs: vi.fn(),
}))

vi.mock('@vultisig/core-mpc/keysign/tw/getKeysignTwPublicKey', () => ({
  getKeysignTwPublicKey: vi.fn(),
}))

vi.mock('@vultisig/core-mpc/keysign/utils/getKeysignChain', () => ({
  getKeysignChain: vi.fn(),
}))

import { buildSendKeysignPayload } from '@vultisig/core-mpc/keysign/send/build'
import type { Vault as CoreVault } from '@vultisig/core-mpc/vault/Vault'

import type { WasmProvider } from '../../../src/context/SdkContext'
import { TransactionBuilder } from '../../../src/vault/services/TransactionBuilder'
import { VaultErrorCode } from '../../../src/vault/VaultError'

describe('TransactionBuilder', () => {
  let builder: TransactionBuilder
  let mockVaultData: CoreVault
  let mockWasmProvider: WasmProvider

  const mockCoin = {
    chain: Chain.Ethereum,
    address: '0x1234567890abcdef1234567890abcdef12345678',
    ticker: 'ETH',
    decimals: 18,
  }

  beforeEach(() => {
    vi.clearAllMocks()

    mockVaultData = {
      name: 'Test Vault',
      publicKeys: {
        ecdsa: 'mock-ecdsa-pubkey',
        eddsa: 'mock-eddsa-pubkey',
      },
      hexChainCode: 'mock-chain-code',
      signers: ['local-party-1'],
      localPartyId: 'local-party-1',
      createdAt: Date.now(),
      libType: 'DKLS',
      isBackedUp: true,
      order: 0,
      keyShares: { ecdsa: '', eddsa: '' },
    }

    mockWasmProvider = {
      getWalletCore: vi.fn().mockResolvedValue({
        PublicKey: {
          createWithData: vi.fn(),
        },
      }),
      initializeDkls: vi.fn().mockResolvedValue(undefined),
      initializeSchnorr: vi.fn().mockResolvedValue(undefined),
      initialize: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue({ walletCore: true, dkls: true, schnorr: true }),
    }

    builder = new TransactionBuilder(mockVaultData, mockWasmProvider)
  })

  describe('prepareSendTx', () => {
    it('rejects zero amount without building payload', async () => {
      vi.mocked(buildSendKeysignPayload).mockClear()

      await expect(
        builder.prepareSendTx({
          coin: mockCoin,
          receiver: '0xabcdef1234567890abcdef1234567890abcdef12',
          amount: 0n,
        })
      ).rejects.toMatchObject({ code: VaultErrorCode.InvalidAmount })

      expect(buildSendKeysignPayload).not.toHaveBeenCalled()
    })
  })

  describe('estimateSendFee', () => {
    it('should estimate the fee for a send transaction', async () => {
      const { getSendFeeEstimate } = await import('@vultisig/core-mpc/keysign/send/getSendFeeEstimate')
      const expectedFee = 21000000000000n // 21000 gwei

      vi.mocked(getSendFeeEstimate).mockResolvedValue(expectedFee)

      const fee = await builder.estimateSendFee({
        coin: mockCoin,
        receiver: '0xabcdef1234567890abcdef1234567890abcdef12',
        amount: 1000000000000000000n, // 1 ETH
      })

      expect(fee).toBe(expectedFee)
      expect(getSendFeeEstimate).toHaveBeenCalledWith(
        expect.objectContaining({
          coin: mockCoin,
          receiver: '0xabcdef1234567890abcdef1234567890abcdef12',
          amount: 1000000000000000000n,
          vaultId: 'mock-ecdsa-pubkey',
          localPartyId: 'local-party-1',
          libType: 'DKLS',
        })
      )
    })

    it('should pass memo and feeSettings through', async () => {
      const { getSendFeeEstimate } = await import('@vultisig/core-mpc/keysign/send/getSendFeeEstimate')
      vi.mocked(getSendFeeEstimate).mockResolvedValue(50000n)

      await builder.estimateSendFee({
        coin: mockCoin,
        receiver: '0xabcdef1234567890abcdef1234567890abcdef12',
        amount: 500n,
        memo: 'test memo',
        feeSettings: { gasPrice: '50000000000' } as any,
      })

      expect(getSendFeeEstimate).toHaveBeenCalledWith(
        expect.objectContaining({
          memo: 'test memo',
          feeSettings: { gasPrice: '50000000000' },
        })
      )
    })

    it('should throw VaultError when estimation fails', async () => {
      const { getSendFeeEstimate } = await import('@vultisig/core-mpc/keysign/send/getSendFeeEstimate')
      vi.mocked(getSendFeeEstimate).mockRejectedValue(new Error('Network error'))

      await expect(
        builder.estimateSendFee({
          coin: mockCoin,
          receiver: '0xabcdef1234567890abcdef1234567890abcdef12',
          amount: 1000n,
        })
      ).rejects.toThrow('Failed to estimate send fee: Network error')
    })

    it('rejects zero amount', async () => {
      const { getSendFeeEstimate } = await import('@vultisig/core-mpc/keysign/send/getSendFeeEstimate')
      vi.mocked(getSendFeeEstimate).mockClear()

      await expect(
        builder.estimateSendFee({
          coin: mockCoin,
          receiver: '0xabcdef1234567890abcdef1234567890abcdef12',
          amount: 0n,
        })
      ).rejects.toMatchObject({ code: VaultErrorCode.InvalidAmount })

      expect(getSendFeeEstimate).not.toHaveBeenCalled()
    })
  })
})
