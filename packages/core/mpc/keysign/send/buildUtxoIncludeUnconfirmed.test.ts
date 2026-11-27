import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import { Chain, UtxoChain } from '@vultisig/core-chain/Chain'
import { getCoinType } from '@vultisig/core-chain/coin/coinType'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUtxoByteFee: vi.fn(),
  getZcashBranchIdHex: vi.fn(),
  getUtxoAddressInfo: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/utxo/fee/byteFee', () => ({
  getUtxoByteFee: mocks.getUtxoByteFee,
}))
vi.mock('@vultisig/core-chain/chains/utxo/zcashBranchId', () => ({
  getZcashBranchIdHex: mocks.getZcashBranchIdHex,
}))
vi.mock('@vultisig/core-chain/chains/utxo/client/getUtxoAddressInfo', () => ({
  getUtxoAddressInfo: mocks.getUtxoAddressInfo,
}))

import { getPreSigningHashes } from '../../tx/preSigningHashes'
import { BuildKeysignPayloadError } from '../error'
import { getEncodedSigningInputs } from '../signingInputs'
import { buildSendKeysignPayload } from './build'

describe('buildSendKeysignPayload — real WalletCore includeUnconfirmed UTXO planning', () => {
  let walletCore: WalletCore
  let senderPubKey: ReturnType<ReturnType<WalletCore['PrivateKey']['createWithData']>['getPublicKeySecp256k1']>
  let recipientPubKey: ReturnType<ReturnType<WalletCore['PrivateKey']['createWithData']>['getPublicKeySecp256k1']>

  const confirmedHash = '11'.repeat(32)
  const pendingHash = '22'.repeat(32)
  const pendingDustHash = '33'.repeat(32)
  const pendingUnspendableHash = '44'.repeat(32)
  const strip0x = (hex: string) => hex.replace(/^0x/i, '')

  const deriveAddress = (chain: UtxoChain, pubKey: typeof senderPubKey) =>
    walletCore.AnyAddress.createWithPublicKey(pubKey, getCoinType({ walletCore, chain })).description()

  const mockAddressPage = (
    address: string,
    utxo: Array<{
      block_id: number
      transaction_hash: string
      index: number
      value: number
      is_spendable?: boolean
    }>
  ) => {
    mocks.getUtxoAddressInfo.mockResolvedValue({
      data: {
        [address]: {
          address: {
            balance: utxo.reduce((sum, u) => sum + u.value, 0),
            unspent_output_count: utxo.length,
          },
          utxo: utxo.map(entry => ({
            ...entry,
            value_usd: 1,
            recipient: address,
            script_hex: '0014',
            is_from_coinbase: false,
          })),
        },
      },
    })
  }

  beforeAll(async () => {
    walletCore = await initWasm()
    const senderPrivKey = walletCore.PrivateKey.createWithData(Buffer.from('01'.repeat(32), 'hex'))
    senderPubKey = senderPrivKey.getPublicKeySecp256k1(true)
    const recipientPrivKey = walletCore.PrivateKey.createWithData(Buffer.from('02'.repeat(32), 'hex'))
    recipientPubKey = recipientPrivKey.getPublicKeySecp256k1(true)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUtxoByteFee.mockResolvedValue(10n)
    mocks.getZcashBranchIdHex.mockResolvedValue('c8e71055')
  })

  it('rejects spending unconfirmed funds by default and succeeds with valid sighashes when includeUnconfirmed is true', async () => {
    const sender = deriveAddress(Chain.Bitcoin, senderPubKey)
    const receiver = deriveAddress(Chain.Bitcoin, recipientPubKey)

    mockAddressPage(sender, [
      { block_id: 900_000, transaction_hash: confirmedHash, index: 0, value: 10_000_000, is_spendable: true },
      { block_id: -1, transaction_hash: pendingHash, index: 1, value: 50_000_000, is_spendable: true },
      { block_id: -1, transaction_hash: pendingDustHash, index: 2, value: 546, is_spendable: true },
      { block_id: -1, transaction_hash: pendingUnspendableHash, index: 3, value: 30_000_000, is_spendable: false },
    ])

    await expect(
      buildSendKeysignPayload({
        coin: { chain: Chain.Bitcoin, ticker: 'BTC', address: sender, decimals: 8 },
        receiver,
        amount: 55_000_000n,
        vaultId: 'vault-pub',
        localPartyId: 'party-1',
        publicKey: senderPubKey,
        libType: 'DKLS',
        walletCore,
      })
    ).rejects.toMatchObject({
      name: 'BuildKeysignPayloadError',
      type: 'not-enough-funds',
    } satisfies Partial<BuildKeysignPayloadError>)

    const payload = await buildSendKeysignPayload({
      coin: { chain: Chain.Bitcoin, ticker: 'BTC', address: sender, decimals: 8 },
      receiver,
      amount: 55_000_000n,
      vaultId: 'vault-pub',
      localPartyId: 'party-1',
      publicKey: senderPubKey,
      libType: 'DKLS',
      walletCore,
      includeUnconfirmed: true,
    })

    expect(payload.utxoInfo.map(u => `${strip0x(u.hash)}:${u.index}`).sort()).toEqual([
      `${confirmedHash}:0`,
      `${pendingHash}:1`,
    ])
    expect(payload.utxoInfo.map(u => strip0x(u.hash))).not.toContain(pendingDustHash)
    expect(payload.utxoInfo.map(u => strip0x(u.hash))).not.toContain(pendingUnspendableHash)

    const [txInputData] = await getEncodedSigningInputs({
      keysignPayload: payload,
      walletCore,
      publicKey: senderPubKey,
    })
    const hashes = getPreSigningHashes({ walletCore, chain: Chain.Bitcoin, txInputData })
    expect(hashes).toHaveLength(2)
    for (const hash of hashes) {
      expect(hash).toHaveLength(32)
    }
  })

  it('sweeps confirmed and spendable unconfirmed outputs under sendMaxAmount when includeUnconfirmed is true', async () => {
    const sender = deriveAddress(Chain.Bitcoin, senderPubKey)
    const receiver = deriveAddress(Chain.Bitcoin, recipientPubKey)

    mockAddressPage(sender, [
      { block_id: 900_000, transaction_hash: confirmedHash, index: 0, value: 10_000_000, is_spendable: true },
      { block_id: -1, transaction_hash: pendingHash, index: 1, value: 50_000_000, is_spendable: true },
    ])

    const payload = await buildSendKeysignPayload({
      coin: { chain: Chain.Bitcoin, ticker: 'BTC', address: sender, decimals: 8 },
      receiver,
      amount: 60_000_000n,
      sendMaxAmount: true,
      vaultId: 'vault-pub',
      localPartyId: 'party-1',
      publicKey: senderPubKey,
      libType: 'DKLS',
      walletCore,
      includeUnconfirmed: true,
    })

    expect(payload.utxoInfo.map(u => strip0x(u.hash)).sort()).toEqual([confirmedHash, pendingHash])
  })

  it('fails with not-enough-funds when no spendable confirmed or unconfirmed outputs exist', async () => {
    const sender = deriveAddress(Chain.Bitcoin, senderPubKey)
    const receiver = deriveAddress(Chain.Bitcoin, recipientPubKey)

    mockAddressPage(sender, [])

    await expect(
      buildSendKeysignPayload({
        coin: { chain: Chain.Bitcoin, ticker: 'BTC', address: sender, decimals: 8 },
        receiver,
        amount: 10_000n,
        vaultId: 'vault-pub',
        localPartyId: 'party-1',
        publicKey: senderPubKey,
        libType: 'DKLS',
        walletCore,
        includeUnconfirmed: true,
      })
    ).rejects.toMatchObject({
      name: 'BuildKeysignPayloadError',
      type: 'not-enough-funds',
    } satisfies Partial<BuildKeysignPayloadError>)
  })

  it.each([
    [Chain.Bitcoin, 'BTC'],
    [Chain.BitcoinCash, 'BCH'],
    [Chain.Litecoin, 'LTC'],
    [Chain.Dogecoin, 'DOGE'],
    [Chain.Zcash, 'ZEC'],
  ] as const)(
    'plans and produces valid pre-signing hashes from mempool outputs on %s when includeUnconfirmed is true',
    async (chain, ticker) => {
      const sender = deriveAddress(chain, senderPubKey)
      const receiver = deriveAddress(chain, recipientPubKey)

      mockAddressPage(sender, [
        { block_id: -1, transaction_hash: pendingHash, index: 0, value: 50_000_000, is_spendable: true },
        { block_id: 0, transaction_hash: confirmedHash, index: 1, value: 10_000_000, is_spendable: true },
      ])

      const payload = await buildSendKeysignPayload({
        coin: { chain, ticker, address: sender, decimals: 8 },
        receiver,
        amount: 55_000_000n,
        vaultId: 'vault-pub',
        localPartyId: 'party-1',
        publicKey: senderPubKey,
        libType: 'DKLS',
        walletCore,
        includeUnconfirmed: true,
      })

      expect(payload.utxoInfo.map(u => strip0x(u.hash)).sort()).toEqual([confirmedHash, pendingHash])
      const [txInputData] = await getEncodedSigningInputs({
        keysignPayload: payload,
        walletCore,
        publicKey: senderPubKey,
      })
      const hashes = getPreSigningHashes({ walletCore, chain, txInputData })
      expect(hashes).toHaveLength(2)
      for (const hash of hashes) {
        expect(hash).toHaveLength(32)
      }
    }
  )
})
