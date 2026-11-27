import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import { Chain, UtxoChain } from '@vultisig/core-chain/Chain'
import { getCoinType } from '@vultisig/core-chain/coin/coinType'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUtxoByteFee: vi.fn(),
  getZcashBranchIdHex: vi.fn(),
  getUtxos: vi.fn(),
  getCoinBalance: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/utxo/fee/byteFee', () => ({
  getUtxoByteFee: mocks.getUtxoByteFee,
}))
vi.mock('@vultisig/core-chain/chains/utxo/zcashBranchId', () => ({
  getZcashBranchIdHex: mocks.getZcashBranchIdHex,
}))
vi.mock('@vultisig/core-chain/chains/utxo/tx/getUtxos', () => ({
  getUtxos: mocks.getUtxos,
}))
vi.mock('@vultisig/core-chain/coin/balance', () => ({
  getCoinBalance: mocks.getCoinBalance,
}))

import { getPreSigningHashes } from '../../tx/preSigningHashes'
import { BuildKeysignPayloadError } from '../error'
import { getEncodedSigningInputs } from '../signingInputs'
import { buildSendKeysignPayload } from './build'

describe('buildSendKeysignPayload — real WalletCore UTXO coin control', () => {
  let walletCore: WalletCore
  let senderPrivKey: ReturnType<WalletCore['PrivateKey']['createWithData']>
  let senderPubKey: ReturnType<ReturnType<WalletCore['PrivateKey']['createWithData']>['getPublicKeySecp256k1']>
  let recipientPubKey: ReturnType<ReturnType<WalletCore['PrivateKey']['createWithData']>['getPublicKeySecp256k1']>

  const hash50a = '11'.repeat(32)
  const hash50b = '22'.repeat(32)
  const hash10 = '33'.repeat(32)
  const strip0x = (hex: string) => hex.replace(/^0x/i, '')

  const deriveAddress = (chain: UtxoChain, pubKey: typeof senderPubKey) =>
    walletCore.AnyAddress.createWithPublicKey(pubKey, getCoinType({ walletCore, chain })).description()

  beforeAll(async () => {
    walletCore = await initWasm()
    senderPrivKey = walletCore.PrivateKey.createWithData(Buffer.from('01'.repeat(32), 'hex'))
    senderPubKey = senderPrivKey.getPublicKeySecp256k1(true)
    const recipientPrivKey = walletCore.PrivateKey.createWithData(Buffer.from('02'.repeat(32), 'hex'))
    recipientPubKey = recipientPrivKey.getPublicKeySecp256k1(true)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUtxoByteFee.mockResolvedValue(10n)
    mocks.getZcashBranchIdHex.mockResolvedValue('c8e71055')
    mocks.getCoinBalance.mockResolvedValue(110_000_000n)
    mocks.getUtxos.mockResolvedValue([
      { hash: hash50a, index: 0, amount: 50_000_000n },
      { hash: hash50b, index: 0, amount: 50_000_000n },
      { hash: hash10, index: 1, amount: 10_000_000n },
    ])
  })

  it('selects strictly from the candidate pool (0.5 + 0.1 for a 0.55 BTC send) instead of spending 0.5 + 0.5', async () => {
    const sender = deriveAddress(Chain.Bitcoin, senderPubKey)
    const receiver = deriveAddress(Chain.Bitcoin, recipientPubKey)

    const defaultPayload = await buildSendKeysignPayload({
      coin: { chain: Chain.Bitcoin, ticker: 'BTC', address: sender, decimals: 8 },
      receiver,
      amount: 55_000_000n,
      vaultId: 'vault-pub',
      localPartyId: 'party-1',
      publicKey: senderPubKey,
      libType: 'DKLS',
      walletCore,
    })
    expect(mocks.getUtxos).toHaveBeenCalledOnce()
    expect(defaultPayload.utxoInfo.map(u => strip0x(u.hash)).sort()).toEqual([hash50a, hash50b])

    vi.clearAllMocks()
    mocks.getUtxoByteFee.mockResolvedValue(10n)

    const payload = await buildSendKeysignPayload({
      coin: { chain: Chain.Bitcoin, ticker: 'BTC', address: sender, decimals: 8 },
      receiver,
      amount: 55_000_000n,
      vaultId: 'vault-pub',
      localPartyId: 'party-1',
      publicKey: senderPubKey,
      libType: 'DKLS',
      walletCore,
      selectedUtxos: [
        { hash: hash50a, index: 0, amount: 50_000_000n },
        { hash: hash10, index: 1, amount: 10_000_000n },
      ],
    })

    expect(mocks.getUtxos).not.toHaveBeenCalled()
    expect(mocks.getCoinBalance).not.toHaveBeenCalled()
    expect(payload.utxoInfo.map(u => `${strip0x(u.hash)}:${u.index}`).sort()).toEqual([`${hash50a}:0`, `${hash10}:1`])
    expect(payload.utxoInfo.map(u => strip0x(u.hash))).not.toContain(hash50b)

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

  it('plans on demand inside the candidate pool without forcing spend-all when sendMaxAmount is false', async () => {
    const sender = deriveAddress(Chain.Bitcoin, senderPubKey)
    const receiver = deriveAddress(Chain.Bitcoin, recipientPubKey)

    const payload = await buildSendKeysignPayload({
      coin: { chain: Chain.Bitcoin, ticker: 'BTC', address: sender, decimals: 8 },
      receiver,
      amount: 20_000_000n,
      vaultId: 'vault-pub',
      localPartyId: 'party-1',
      publicKey: senderPubKey,
      libType: 'DKLS',
      walletCore,
      selectedUtxos: [
        { hash: hash50a, index: 0, amount: 50_000_000n },
        { hash: hash10, index: 1, amount: 10_000_000n },
      ],
    })

    // Candidate pool is 0.5 + 0.1 BTC, but 0.2 BTC only needs the single 0.5 BTC input.
    expect(payload.utxoInfo).toHaveLength(1)
    expect(strip0x(payload.utxoInfo[0].hash)).toBe(hash50a)
    expect(payload.utxoInfo[0]).toMatchObject({ index: 0, amount: 50_000_000n })
  })

  it('sweeps every candidate UTXO and leaves unselected wallet UTXOs untouched when sendMaxAmount is true', async () => {
    const sender = deriveAddress(Chain.Bitcoin, senderPubKey)
    const receiver = deriveAddress(Chain.Bitcoin, recipientPubKey)

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
      selectedUtxos: [
        { hash: hash50a, index: 0, amount: 50_000_000n },
        { hash: hash10, index: 1, amount: 10_000_000n },
      ],
    })

    expect(payload.utxoInfo).toHaveLength(2)
    expect(payload.utxoInfo.map(u => strip0x(u.hash)).sort()).toEqual([hash50a, hash10])
    expect(payload.utxoInfo.map(u => strip0x(u.hash))).not.toContain(hash50b)
  })

  it('fails with not-enough-funds when the candidate pool cannot cover the send even if the wallet holds more', async () => {
    const sender = deriveAddress(Chain.Bitcoin, senderPubKey)
    const receiver = deriveAddress(Chain.Bitcoin, recipientPubKey)

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
        selectedUtxos: [{ hash: hash10, index: 1, amount: 10_000_000n }],
      })
    ).rejects.toMatchObject({
      name: 'BuildKeysignPayloadError',
      type: 'not-enough-funds',
    } satisfies Partial<BuildKeysignPayloadError>)
  })

  it('allows sweeping a dust-sized selected UTXO paired with a normal UTXO under sendMaxAmount', async () => {
    const sender = deriveAddress(Chain.Bitcoin, senderPubKey)
    const receiver = deriveAddress(Chain.Bitcoin, recipientPubKey)

    const payload = await buildSendKeysignPayload({
      coin: { chain: Chain.Bitcoin, ticker: 'BTC', address: sender, decimals: 8 },
      receiver,
      amount: 50_546n,
      sendMaxAmount: true,
      vaultId: 'vault-pub',
      localPartyId: 'party-1',
      publicKey: senderPubKey,
      libType: 'DKLS',
      walletCore,
      selectedUtxos: [
        { hash: hash50a, index: 0, amount: 50_000n },
        { hash: hash10, index: 1, amount: 546n },
      ],
    })

    expect(payload.utxoInfo.map(u => strip0x(u.hash)).sort()).toEqual([hash50a, hash10])
  })

  it.each([
    [Chain.Bitcoin, 'BTC'],
    [Chain.BitcoinCash, 'BCH'],
    [Chain.Litecoin, 'LTC'],
    [Chain.Dogecoin, 'DOGE'],
    [Chain.Dash, 'DASH'],
    [Chain.Zcash, 'ZEC'],
  ] as const)(
    'plans and produces valid pre-signing hashes strictly from selectedUtxos on %s',
    async (chain, ticker) => {
      const sender = deriveAddress(chain, senderPubKey)
      const receiver = deriveAddress(chain, recipientPubKey)

      const payload = await buildSendKeysignPayload({
        coin: { chain, ticker, address: sender, decimals: 8 },
        receiver,
        amount: 55_000_000n,
        vaultId: 'vault-pub',
        localPartyId: 'party-1',
        publicKey: senderPubKey,
        libType: 'DKLS',
        walletCore,
        selectedUtxos: [
          { hash: hash50a, index: 0, amount: 50_000_000n },
          { hash: hash10, index: 1, amount: 10_000_000n },
        ],
      })

      expect(payload.utxoInfo.map(u => strip0x(u.hash)).sort()).toEqual([hash50a, hash10])
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
