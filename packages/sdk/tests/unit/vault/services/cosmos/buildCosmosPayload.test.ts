import { Chain } from '@vultisig/core-chain/Chain'
import { cosmosGasRecord } from '@vultisig/core-chain/chains/cosmos/gas'
import type { KeysignLibType } from '@vultisig/core-mpc/mpcLib'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetCosmosAccountInfo } = vi.hoisted(() => ({
  mockGetCosmosAccountInfo: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/cosmos/account/getCosmosAccountInfo', () => ({
  getCosmosAccountInfo: mockGetCosmosAccountInfo,
}))

import { buildSignAminoKeysignPayload, buildSignDirectKeysignPayload } from '@/vault/services/cosmos/buildCosmosPayload'

const libType: KeysignLibType = 'DKLS'

const fakePublicKey = {
  data: () => new Uint8Array([1, 2, 3]),
} as import('@trustwallet/wallet-core/dist/src/wallet-core').PublicKey

const accountInfoFixture = {
  address: 'cosmos1testaddr',
  pubkey: null,
  accountNumber: 7,
  sequence: 3,
  latestBlock: '100_0',
}

describe('buildCosmosPayload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCosmosAccountInfo.mockResolvedValue(accountInfoFixture)
  })

  describe('buildSignAminoKeysignPayload', () => {
    describe('skipChainSpecificFetch: true', () => {
      it('uses thorchainSpecific for THORChain', async () => {
        const payload = await buildSignAminoKeysignPayload({
          chain: Chain.THORChain,
          coin: {
            chain: Chain.THORChain,
            address: 'thor1test',
            decimals: 8,
            ticker: 'RUNE',
          },
          msgs: [{ type: 'types/MsgDeposit', value: '{}' }],
          fee: {
            amount: [{ denom: 'rune', amount: '2000000' }],
            gas: '400000',
          },
          vaultId: 'vault-ecdsa',
          localPartyId: 'device-1',
          publicKey: fakePublicKey,
          libType,
          skipChainSpecificFetch: true,
        })

        expect(mockGetCosmosAccountInfo).not.toHaveBeenCalled()
        expect(payload.blockchainSpecific?.case).toBe('thorchainSpecific')
        const thor = payload.blockchainSpecific?.value as {
          accountNumber: bigint
          sequence: bigint
        }
        expect(thor.accountNumber).toBe(0n)
        expect(thor.sequence).toBe(0n)
      })

      it('uses mayaSpecific for MayaChain', async () => {
        const payload = await buildSignAminoKeysignPayload({
          chain: Chain.MayaChain,
          coin: {
            chain: Chain.MayaChain,
            address: 'maya1test',
            decimals: 8,
            ticker: 'CACAO',
          },
          msgs: [{ type: 'types/MsgDeposit', value: '{}' }],
          fee: {
            amount: [{ denom: 'cacao', amount: '1000' }],
            gas: '400000',
          },
          vaultId: 'vault-ecdsa',
          localPartyId: 'device-1',
          publicKey: fakePublicKey,
          libType,
          skipChainSpecificFetch: true,
        })

        expect(mockGetCosmosAccountInfo).not.toHaveBeenCalled()
        expect(payload.blockchainSpecific?.case).toBe('mayaSpecific')
        const maya = payload.blockchainSpecific?.value as {
          accountNumber: bigint
          sequence: bigint
        }
        expect(maya.accountNumber).toBe(0n)
        expect(maya.sequence).toBe(0n)
      })

      it('uses cosmosSpecific with gas from record for Osmosis (IBC)', async () => {
        const payload = await buildSignAminoKeysignPayload({
          chain: Chain.Osmosis,
          coin: {
            chain: Chain.Osmosis,
            address: 'osmo1test',
            decimals: 6,
            ticker: 'OSMO',
          },
          msgs: [
            {
              type: 'cosmos-sdk/MsgSend',
              value: JSON.stringify({
                from_address: 'osmo1test',
                to_address: 'osmo1recv',
                amount: [{ denom: 'uosmo', amount: '1' }],
              }),
            },
          ],
          fee: {
            amount: [{ denom: 'uosmo', amount: '5000' }],
            gas: '200000',
          },
          vaultId: 'vault-ecdsa',
          localPartyId: 'device-1',
          publicKey: fakePublicKey,
          libType,
          skipChainSpecificFetch: true,
        })

        expect(mockGetCosmosAccountInfo).not.toHaveBeenCalled()
        expect(payload.blockchainSpecific?.case).toBe('cosmosSpecific')
        const osmo = payload.blockchainSpecific?.value as {
          gas: bigint
          accountNumber: bigint
          sequence: bigint
        }
        expect(osmo.gas).toBe(cosmosGasRecord.Osmosis)
        expect(osmo.accountNumber).toBe(0n)
        expect(osmo.sequence).toBe(0n)
      })
    })

    it('calls getCosmosAccountInfo when skipChainSpecificFetch is false and applies account fields', async () => {
      const address = 'cosmos1abcdef'
      const payload = await buildSignAminoKeysignPayload({
        chain: Chain.Cosmos,
        coin: {
          chain: Chain.Cosmos,
          address,
          decimals: 6,
          ticker: 'ATOM',
        },
        msgs: [
          {
            type: 'cosmos-sdk/MsgSend',
            value: JSON.stringify({
              from_address: address,
              to_address: 'cosmos1recv',
              amount: [{ denom: 'uatom', amount: '1000' }],
            }),
          },
        ],
        fee: {
          amount: [{ denom: 'uatom', amount: '5000' }],
          gas: '200000',
        },
        vaultId: 'vault-ecdsa',
        localPartyId: 'device-1',
        publicKey: fakePublicKey,
        libType,
        skipChainSpecificFetch: false,
      })

      expect(mockGetCosmosAccountInfo).toHaveBeenCalledTimes(1)
      expect(mockGetCosmosAccountInfo).toHaveBeenCalledWith({
        chain: Chain.Cosmos,
        address,
      })

      expect(payload.blockchainSpecific?.case).toBe('cosmosSpecific')
      const atom = payload.blockchainSpecific?.value as {
        gas: bigint
        accountNumber: bigint
        sequence: bigint
      }
      expect(atom.accountNumber).toBe(7n)
      expect(atom.sequence).toBe(3n)
      expect(atom.gas).toBe(cosmosGasRecord.Cosmos)
    })
  })

  describe('buildSignDirectKeysignPayload', () => {
    const directBase = {
      coin: {
        chain: Chain.Cosmos,
        address: 'cosmos1abcdef',
        decimals: 6,
        ticker: 'ATOM',
      },
      bodyBytes: 'Ym9keS1ieXRlcw==',
      authInfoBytes: 'YXV0aC1ieXRlcw==',
      chainId: 'cosmoshub-4',
      accountNumber: '42',
      vaultId: 'vault-ecdsa',
      localPartyId: 'device-1',
      publicKey: fakePublicKey,
      libType,
    } as const

    it('does not call getCosmosAccountInfo when skipChainSpecificFetch is true; sequence stays default', async () => {
      const payload = await buildSignDirectKeysignPayload({
        ...directBase,
        chain: Chain.Cosmos,
        skipChainSpecificFetch: true,
      })

      expect(mockGetCosmosAccountInfo).not.toHaveBeenCalled()
      expect(payload.blockchainSpecific?.case).toBe('cosmosSpecific')
      const directSkip = payload.blockchainSpecific?.value as {
        accountNumber: bigint
        sequence: bigint
      }
      expect(directSkip.accountNumber).toBe(42n)
      expect(directSkip.sequence).toBe(0n)
    })

    it('calls getCosmosAccountInfo when skipChainSpecificFetch is false; sequence comes from chain', async () => {
      const payload = await buildSignDirectKeysignPayload({
        ...directBase,
        chain: Chain.Cosmos,
        skipChainSpecificFetch: false,
      })

      expect(mockGetCosmosAccountInfo).toHaveBeenCalledTimes(1)
      expect(mockGetCosmosAccountInfo).toHaveBeenCalledWith({
        chain: Chain.Cosmos,
        address: directBase.coin.address,
      })

      expect(payload.blockchainSpecific?.case).toBe('cosmosSpecific')
      const directFetch = payload.blockchainSpecific?.value as {
        accountNumber: bigint
        sequence: bigint
      }
      expect(directFetch.accountNumber).toBe(42n)
      expect(directFetch.sequence).toBe(3n)
    })
  })
})
