import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import { beforeAll, describe, expect, it } from 'vitest'

import { getEncodedSigningInputs } from '../../keysign/signingInputs'
import {
  RippleSpecificSchema,
  TonSpecificSchema,
  TransactionType,
} from '../../types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '../../types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '../../types/vultisig/keysign/v1/keysign_message_pb'
import { getPreSigningHashes } from '.'

type RippleFixture = {
  senderPrivateKeyHex: string
  recipientPrivateKeyHex: string
  senderAddress: string
  recipientAddress: string
  senderPublicKeyHex: string
  amountDrops: string
  feeDrops: string
  sequence: number
  lastLedgerSequence: number
  flags?: number
  memo?: string
  expectedSigningHashHex: string
}

type RippleIssuedFixture = {
  senderPrivateKeyHex: string
  recipientPrivateKeyHex: string
  senderAddress: string
  recipientAddress: string
  senderPublicKeyHex: string
  issuerAddress: string
  currencyCode: string
  tokenTicker: string
  decimals: number
  amountBaseUnits: string
  expectedValue: string
  feeDrops: string
  sequence: number
  lastLedgerSequence: number
  destinationTag: number
  flags?: number
  memo?: string
  expectedSigningHashHex: string
}

type TonNativeFixture = {
  publicKeyEd25519Hex: string
  senderAddress: string
  recipientAddress: string
  amountNanotons: string
  bounceable: boolean
  sequenceNumber: number
  expireAt: number
  expectedSigningHashHex: string
}

type TonJettonFixture = TonNativeFixture & {
  jettonWalletAddress: string
  jettonMasterAddress: string
  amountMinimalUnits: string
  gasAmountNanotons: string
  forwardAmountNanotons: string
  memo?: string
  isActiveDestination: boolean
}

const loadFixture = <T>(name: string): T =>
  JSON.parse(readFileSync(resolve(__dirname, '../../../../../testdata/cross-encoder-golden', name), 'utf8')) as T

const ripple = loadFixture<RippleFixture>('ripple-payment.json')
const rippleMemo = loadFixture<RippleFixture>('ripple-payment-memo.json')
const rippleIssued = loadFixture<RippleIssuedFixture>('ripple-issued-payment.json')
const rippleIssuedMemo = loadFixture<RippleIssuedFixture>('ripple-issued-payment-memo.json')
const tonNative = loadFixture<TonNativeFixture>('ton-native-transfer.json')
const tonJetton = loadFixture<TonJettonFixture>('ton-jetton-transfer.json')
const tonJettonInactive = loadFixture<TonJettonFixture>('ton-jetton-transfer-inactive.json')
const tonJettonMemo = loadFixture<TonJettonFixture>('ton-jetton-transfer-memo.json')

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

describe('WalletCore cross-encoder signing hashes', () => {
  let walletCore: WalletCore

  beforeAll(async () => {
    walletCore = await initWasm()
  })

  const getSigningHash = async (
    keysignPayload: Parameters<typeof getEncodedSigningInputs>[0]['keysignPayload'],
    chain: Chain
  ) => {
    const [txInputData] = await getEncodedSigningInputs({
      keysignPayload,
      walletCore,
    })
    const hashes = getPreSigningHashes({ walletCore, chain, txInputData })
    expect(hashes).toHaveLength(1)
    return hex(hashes[0])
  }

  const expectRippleFixture = async (fixture: RippleFixture) => {
    const senderPrivateKey = walletCore.PrivateKey.createWithData(Buffer.from(fixture.senderPrivateKeyHex, 'hex'))
    const senderPublicKey = senderPrivateKey.getPublicKeySecp256k1(true)
    const recipientPrivateKey = walletCore.PrivateKey.createWithData(Buffer.from(fixture.recipientPrivateKeyHex, 'hex'))
    const recipientPublicKey = recipientPrivateKey.getPublicKeySecp256k1(true)

    expect(hex(senderPublicKey.data())).toBe(fixture.senderPublicKeyHex)
    expect(walletCore.AnyAddress.createWithPublicKey(senderPublicKey, walletCore.CoinType.xrp).description()).toBe(
      fixture.senderAddress
    )
    expect(walletCore.AnyAddress.createWithPublicKey(recipientPublicKey, walletCore.CoinType.xrp).description()).toBe(
      fixture.recipientAddress
    )

    const payload = create(KeysignPayloadSchema, {
      coin: create(CoinSchema, {
        chain: Chain.Ripple,
        ticker: 'XRP',
        address: fixture.senderAddress,
        decimals: 6,
        isNativeToken: true,
        hexPublicKey: fixture.senderPublicKeyHex,
      }),
      toAddress: fixture.recipientAddress,
      toAmount: fixture.amountDrops,
      memo: fixture.memo,
      blockchainSpecific: {
        case: 'rippleSpecific',
        value: create(RippleSpecificSchema, {
          gas: BigInt(fixture.feeDrops),
          sequence: BigInt(fixture.sequence),
          lastLedgerSequence: BigInt(fixture.lastLedgerSequence),
        }),
      },
    })

    await expect(getSigningHash(payload, Chain.Ripple)).resolves.toBe(fixture.expectedSigningHashHex)
  }

  it('matches the shared XRP Payment fixture consumed by the RN-JS builder suite', async () => {
    expect(ripple.flags).toBe(0)
    await expectRippleFixture(ripple)
  })

  it('matches the shared XRP Payment memo fixture consumed by the RN-JS builder suite', async () => {
    expect(rippleMemo.flags).toBeUndefined()
    await expectRippleFixture(rippleMemo)
  })

  // An issued-currency Payment is built by both encoders independently, and an
  // XRPL token amount is serialized as a normalised mantissa/exponent rather
  // than verbatim digits. Pin the two against each other so a rounding or
  // field-set change on either side cannot silently split a mixed-platform
  // committee's signing preimage.
  const expectRippleIssuedFixture = async (fixture: RippleIssuedFixture) => {
    const payload = create(KeysignPayloadSchema, {
      coin: create(CoinSchema, {
        chain: Chain.Ripple,
        ticker: fixture.tokenTicker,
        address: fixture.senderAddress,
        contractAddress: `${fixture.currencyCode}.${fixture.issuerAddress}`,
        decimals: fixture.decimals,
        isNativeToken: false,
        hexPublicKey: fixture.senderPublicKeyHex,
      }),
      toAddress: fixture.recipientAddress,
      toAmount: fixture.amountBaseUnits,
      memo: fixture.memo,
      blockchainSpecific: {
        case: 'rippleSpecific',
        value: create(RippleSpecificSchema, {
          gas: BigInt(fixture.feeDrops),
          sequence: BigInt(fixture.sequence),
          lastLedgerSequence: BigInt(fixture.lastLedgerSequence),
          destinationTag: fixture.destinationTag,
          transactionType: TransactionType.RIPPLE_PAYMENT,
        }),
      },
    })

    await expect(getSigningHash(payload, Chain.Ripple)).resolves.toBe(fixture.expectedSigningHashHex)
  }

  it('matches the shared issued-currency Payment fixture consumed by the RN-JS builder suite', async () => {
    expect(rippleIssued.flags).toBe(0)
    await expectRippleIssuedFixture(rippleIssued)
  })

  it('matches the shared issued-currency Payment memo fixture consumed by the RN-JS builder suite', async () => {
    expect(rippleIssuedMemo.flags).toBeUndefined()
    await expectRippleIssuedFixture(rippleIssuedMemo)
  })

  it('matches the shared TON native-transfer fixture consumed by the RN-JS builder suite', async () => {
    const payload = create(KeysignPayloadSchema, {
      coin: create(CoinSchema, {
        chain: Chain.Ton,
        ticker: 'TON',
        address: tonNative.senderAddress,
        decimals: 9,
        isNativeToken: true,
        hexPublicKey: tonNative.publicKeyEd25519Hex,
      }),
      toAddress: tonNative.recipientAddress,
      toAmount: tonNative.amountNanotons,
      blockchainSpecific: {
        case: 'tonSpecific',
        value: create(TonSpecificSchema, {
          sequenceNumber: BigInt(tonNative.sequenceNumber),
          expireAt: BigInt(tonNative.expireAt),
          bounceable: tonNative.bounceable,
        }),
      },
    })

    await expect(getSigningHash(payload, Chain.Ton)).resolves.toBe(tonNative.expectedSigningHashHex)
  })

  const expectJettonFixture = async (fixture: TonJettonFixture) => {
    const payload = create(KeysignPayloadSchema, {
      coin: create(CoinSchema, {
        chain: Chain.Ton,
        ticker: 'JETTON',
        address: fixture.senderAddress,
        contractAddress: fixture.jettonMasterAddress,
        decimals: 6,
        isNativeToken: false,
        hexPublicKey: fixture.publicKeyEd25519Hex,
      }),
      toAddress: fixture.recipientAddress,
      toAmount: fixture.amountMinimalUnits,
      memo: fixture.memo,
      blockchainSpecific: {
        case: 'tonSpecific',
        value: create(TonSpecificSchema, {
          sequenceNumber: BigInt(fixture.sequenceNumber),
          expireAt: BigInt(fixture.expireAt),
          bounceable: fixture.bounceable,
          jettonAddress: fixture.jettonWalletAddress,
          isActiveDestination: fixture.isActiveDestination,
        }),
      },
    })

    await expect(getSigningHash(payload, Chain.Ton)).resolves.toBe(fixture.expectedSigningHashHex)
  }

  it('matches the shared dispatched TON Jetton fixture consumed by the RN-JS builder suite', async () => {
    expect(tonJetton.gasAmountNanotons).toBe('80000000')
    expect(tonJetton.forwardAmountNanotons).toBe('1')
    await expectJettonFixture(tonJetton)
  })

  it('matches the shared inactive-destination TON Jetton fixture', async () => {
    expect(tonJettonInactive.forwardAmountNanotons).toBe('0')
    await expectJettonFixture(tonJettonInactive)
  })

  it('matches the shared TON Jetton memo fixture', async () => {
    expect(tonJettonMemo.forwardAmountNanotons).toBe('1')
    await expectJettonFixture(tonJettonMemo)
  })
})
