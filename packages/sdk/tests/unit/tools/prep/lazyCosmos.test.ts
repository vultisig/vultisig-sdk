import type { WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it, vi } from 'vitest'

const { loaded, amino, direct, publicKey } = vi.hoisted(() => ({
  loaded: vi.fn(),
  amino: vi.fn().mockResolvedValue({ mode: 'amino' }),
  direct: vi.fn().mockResolvedValue({ mode: 'direct' }),
  publicKey: { data: () => new Uint8Array(33) },
}))

vi.mock('@/vault/services/cosmos/buildCosmosPayload', () => {
  loaded()
  return { buildSignAminoKeysignPayload: amino, buildSignDirectKeysignPayload: direct }
})
vi.mock('@vultisig/core-chain/publicKey/getPublicKey', () => ({ getPublicKey: () => publicKey }))

// Import the actual barrel; the factory above records when the builder is evaluated.
import { prepareSignAminoTxFromKeys, prepareSignDirectTxFromKeys } from '@/tools/prep'
import type { VaultIdentity } from '@/tools/prep/types'

const identity: VaultIdentity = {
  ecdsaPublicKey: 'public-ecdsa',
  eddsaPublicKey: 'public-eddsa',
  hexChainCode: 'chain-code',
  localPartyId: 'party',
  libType: 'DKLS',
}
const coin = { chain: Chain.Cosmos, address: 'cosmos1test', decimals: 6, ticker: 'ATOM' }
const walletCore = {} as WalletCore

describe('lazy Cosmos builder', () => {
  it('loads only after validation, and captures arguments before the import yields', async () => {
    expect(loaded).not.toHaveBeenCalled()
    await expect(
      prepareSignAminoTxFromKeys(
        identity,
        {
          chain: Chain.Ethereum as never,
          coin,
          msgs: [],
          fee: { amount: [], gas: '0' },
        },
        undefined,
        walletCore
      )
    ).rejects.toThrow('does not support SignAmino')
    await expect(
      prepareSignDirectTxFromKeys(
        identity,
        {
          chain: Chain.Ethereum as never,
          coin,
          bodyBytes: '',
          authInfoBytes: '',
          chainId: '',
          accountNumber: '0',
        },
        undefined,
        walletCore
      )
    ).rejects.toThrow('does not support SignDirect')
    expect(loaded).not.toHaveBeenCalled()

    const input = {
      chain: Chain.Cosmos,
      coin: { ...coin },
      msgs: [{ type: 'cosmos-sdk/MsgVote', value: '{}' }],
      fee: { amount: [{ denom: 'uatom', amount: '5' }], gas: '10' },
      memo: 'original',
    }
    const options = { skipChainSpecificFetch: true }
    const identityCopy = { ...identity }
    const pending = prepareSignAminoTxFromKeys(identityCopy, input, options, walletCore)
    input.memo = 'changed'
    input.coin.address = 'changed'
    input.msgs[0].value = 'changed'
    input.fee.amount[0].amount = '999'
    input.fee.gas = '999'
    options.skipChainSpecificFetch = false
    identityCopy.localPartyId = 'changed'
    await expect(pending).resolves.toEqual({ mode: 'amino' })
    expect(loaded).toHaveBeenCalledTimes(1)
    expect(amino).toHaveBeenCalledWith(
      expect.objectContaining({
        memo: 'original',
        coin,
        msgs: [{ type: 'cosmos-sdk/MsgVote', value: '{}' }],
        fee: { amount: [{ denom: 'uatom', amount: '5' }], gas: '10' },
        localPartyId: 'party',
        publicKey,
        skipChainSpecificFetch: true,
      })
    )

    await expect(
      prepareSignDirectTxFromKeys(
        identity,
        {
          chain: Chain.Cosmos,
          coin,
          bodyBytes: 'CgA=',
          authInfoBytes: 'EgA=',
          chainId: 'cosmoshub-4',
          accountNumber: '42',
        },
        { skipChainSpecificFetch: true },
        walletCore
      )
    ).resolves.toEqual({ mode: 'direct' })
    expect(loaded).toHaveBeenCalledTimes(1)
    expect(direct).toHaveBeenCalledWith(
      expect.objectContaining({
        accountNumber: '42',
        vaultId: identity.ecdsaPublicKey,
        localPartyId: identity.localPartyId,
        publicKey,
        skipChainSpecificFetch: true,
      })
    )
  })
})
