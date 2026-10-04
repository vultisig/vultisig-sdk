/**
 * SwapKit's pre-built Cardano route (`tx_type = "CARDANO_PREBUILT"`).
 *
 * MPC keysign only converges when every device signs the same digest. For
 * this route that is blake2b-256 of the body SwapKit built, sliced verbatim
 * out of the CBOR envelope — so this suite pins:
 *
 * - the digest of a real captured `/v3/swap` transaction, the same vector the
 *   iOS suite (`SwapKitCardanoSignerTests`) pins;
 * - the body rules a co-signer enforces before signing, matching Android's and
 *   iOS's `verifyBody`;
 * - the whole path through getEncodedSigningInputs → getPreSigningHashes →
 *   compileTx on real WalletCore, signature included.
 */
import { Buffer } from 'buffer'

import { create } from '@bufbuild/protobuf'
import { blake2b } from '@noble/hashes/blake2.js'
import { initWasm, TW, type WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import {
  cborArray,
  cborBytes,
  cborMap,
  cborUint,
  concat,
} from '@vultisig/core-chain/chains/cardano/cip30/cardanoCborPrimitives'
import { cardanoTxBodyHash } from '@vultisig/core-chain/chains/cardano/cip30/cardanoTxBodyHash'
import { deriveCardanoAddress } from '@vultisig/core-chain/publicKey/address/cardano'
import { beforeAll, describe, expect, it } from 'vitest'

import { getEncodedSigningInputs } from '../keysign/signingInputs'
import { Coin, CoinSchema } from '../types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '../types/vultisig/keysign/v1/keysign_message_pb'
import { SwapKitSwapPayloadSchema } from '../types/vultisig/keysign/v1/swapkit_swap_payload_pb'
import { compileTx } from './compile/compileTx'
import { getPreSigningHashes } from './preSigningHashes'
import {
  buildSignedSwapKitCardanoTx,
  getSwapKitCardanoPrebuiltPayload,
  getSwapKitCardanoPrebuiltPreSigningHash,
  getSwapKitCardanoPrebuiltSigningInput,
  verifySwapKitCardanoBody,
} from './swapkitCardanoPrebuilt'

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')
const fromHex = (value: string) => new Uint8Array(Buffer.from(value, 'hex'))

/**
 * Real SwapKit `/v3/swap` transaction (Cardano source, NEAR-routed): one
 * input, a deposit and a change output, fee 0x2888d, ttl 0x0b324cbb, empty
 * witness set. Shared with the iOS suite.
 */
const capturedEnvelope = fromHex(
  '84a40081825820f18b3c232d78ca5b1c9e5112314261d839d52a12a5c446c4f80317dc8ac60d48' +
    '000182a200581d618749053dab2309d9b9eba75e17b0406d78302503b4187ca3af260960011a02' +
    'b54eb8a200581d6148838772eed76ee662d3d444e4f8791544e62fa800eb775ec84de62e011a02' +
    '2046f7021a0002888d031a0b324cbba0f5f6'
)
const capturedDigest = 'f568726d7291983d6ba0e7fc5a00b242f0016ed38d0dd3930d86ced8963ba597'

const vaultPublicKey = new Uint8Array(32).fill(0x11)
const enterpriseAddress = (publicKey: Uint8Array) => concat([Uint8Array.of(0x61), blake2b(publicKey, { dkLen: 28 })])
const vaultAddress = enterpriseAddress(vaultPublicKey)
const depositAddress = new Uint8Array(29).fill(0x99)

const inputs = cborArray([cborArray([cborBytes(new Uint8Array(32).fill(0x22)), cborUint(0)])])
const multiAsset = cborMap([
  [cborBytes(new Uint8Array(28).fill(0x33)), cborMap([[cborBytes(fromHex('aa')), cborUint(5)]])],
])
const setTag = Uint8Array.of(0xd9, 0x01, 0x02)

type OutputInput = {
  address: Uint8Array
  lovelace: number
  hasAssets?: boolean
  extras?: Array<[Uint8Array, Uint8Array]>
}

const outputValue = ({ lovelace, hasAssets }: OutputInput) =>
  hasAssets ? cborArray([cborUint(lovelace), multiAsset]) : cborUint(lovelace)

/** Post-Alonzo map-shaped output. */
const output = (input: OutputInput) =>
  cborMap([[cborUint(0), cborBytes(input.address)], [cborUint(1), outputValue(input)], ...(input.extras ?? [])])

/** Legacy array-shaped output. */
const legacyOutput = (input: OutputInput, extras: Uint8Array[] = []) =>
  cborArray([cborBytes(input.address), outputValue(input), ...extras])

type BodyInput = {
  outputs?: Uint8Array[]
  fee?: number
  extraFields?: Array<[number, Uint8Array]>
}

const field = (key: number, value: Uint8Array): [Uint8Array, Uint8Array] => [cborUint(key), value]

const body = ({ outputs, fee = 170_000, extraFields = [] }: BodyInput) =>
  cborMap([
    field(0, inputs),
    ...(outputs ? [field(1, cborArray(outputs))] : []),
    field(2, cborUint(fee)),
    ...extraFields.map(([key, value]) => field(key, value)),
  ])

const emptyWitnessSet = Uint8Array.of(0xa0)
const isValidTrue = Uint8Array.of(0xf5)
const noAuxData = Uint8Array.of(0xf6)

const envelopeOf = (bodyCbor: Uint8Array) =>
  concat([Uint8Array.of(0x84), bodyCbor, emptyWitnessSet, isValidTrue, noAuxData])

const adaCoin = create(CoinSchema, {
  chain: Chain.Cardano,
  ticker: 'ADA',
  decimals: 6,
  isNativeToken: true,
})

type SwapKitPayloadOverrides = {
  fromAmount?: string
  fromCoin?: Coin
}

const swapKitPayloadOf = (envelope: Uint8Array, overrides: SwapKitPayloadOverrides = {}) =>
  create(SwapKitSwapPayloadSchema, {
    fromCoin: adaCoin,
    fromAmount: '45500000',
    txType: 'CARDANO_PREBUILT',
    txPayload: envelope,
    ...overrides,
  })

const verify = (bodyCbor: Uint8Array, fromAmount = 45_500_000n) =>
  verifySwapKitCardanoBody({ body: bodyCbor, fromAmount, vaultPublicKey })

const vaultChange = output({ address: vaultAddress, lovelace: 5_000_000 })

describe('getSwapKitCardanoPrebuiltPayload', () => {
  const keysignPayloadOf = (chain: Chain, txType: string) =>
    create(KeysignPayloadSchema, {
      coin: create(CoinSchema, { chain, ticker: 'ADA', decimals: 6 }),
      swapPayload: {
        case: 'swapkitSwapPayload',
        value: create(SwapKitSwapPayloadSchema, {
          txType,
          txPayload: capturedEnvelope,
        }),
      },
    })

  it('selects a pre-built Cardano swap', () => {
    expect(getSwapKitCardanoPrebuiltPayload(keysignPayloadOf(Chain.Cardano, 'CARDANO_PREBUILT'))?.txType).toBe(
      'CARDANO_PREBUILT'
    )
  })

  it('leaves the deposit-only CARDANO type to the native send path', () => {
    expect(getSwapKitCardanoPrebuiltPayload(keysignPayloadOf(Chain.Cardano, 'CARDANO'))).toBeUndefined()
  })

  it('ignores the tx type on another chain and a payload with no swap', () => {
    expect(getSwapKitCardanoPrebuiltPayload(keysignPayloadOf(Chain.Bitcoin, 'CARDANO_PREBUILT'))).toBeUndefined()
    expect(
      getSwapKitCardanoPrebuiltPayload(
        create(KeysignPayloadSchema, {
          coin: create(CoinSchema, { chain: Chain.Cardano }),
        })
      )
    ).toBeUndefined()
  })
})

describe('getSwapKitCardanoPrebuiltPreSigningHash', () => {
  it('pins the body hash of the captured SwapKit transaction', () => {
    expect(hex(getSwapKitCardanoPrebuiltPreSigningHash(capturedEnvelope))).toBe(capturedDigest)
  })

  it('hashes exactly the body bytes', () => {
    const bodyCbor = body({ outputs: [vaultChange] })

    expect(hex(getSwapKitCardanoPrebuiltPreSigningHash(envelopeOf(bodyCbor)))).toBe(
      hex(blake2b(bodyCbor, { dkLen: 32 }))
    )
  })

  it('rejects an empty payload', () => {
    expect(() => getSwapKitCardanoPrebuiltPreSigningHash(new Uint8Array())).toThrow(/payload is empty/)
  })

  it('rejects a payload that is not a 4-item array', () => {
    expect(() => getSwapKitCardanoPrebuiltPreSigningHash(capturedEnvelope.subarray(1))).toThrow(/4-item CBOR array/)
  })

  it('rejects trailing bytes after the envelope', () => {
    expect(() => getSwapKitCardanoPrebuiltPreSigningHash(concat([capturedEnvelope, Uint8Array.of(0x00)]))).toThrow(
      /trailing bytes/
    )
  })

  it('rejects a truncated envelope', () => {
    expect(() => getSwapKitCardanoPrebuiltPreSigningHash(capturedEnvelope.subarray(0, 60))).toThrow()
  })

  it('rejects an indefinite-length body', () => {
    expect(() => getSwapKitCardanoPrebuiltPreSigningHash(fromHex('84bfffa0f5f6'))).toThrow()
  })
})

describe('verifySwapKitCardanoBody', () => {
  describe('accepts', () => {
    it('a body that only pays back to the vault', () => {
      expect(() => verify(body({ outputs: [vaultChange] }), 0n)).not.toThrow()
    })

    it('a single deposit within the quote plus vault change', () => {
      expect(() =>
        verify(
          body({
            outputs: [output({ address: depositAddress, lovelace: 40_000_000 }), vaultChange],
          })
        )
      ).not.toThrow()
    })

    it('a deposit equal to the quote', () => {
      expect(() =>
        verify(
          body({
            outputs: [output({ address: depositAddress, lovelace: 45_500_000 }), vaultChange],
          })
        )
      ).not.toThrow()
    })

    it('vault outputs carrying native tokens and a datum', () => {
      expect(() =>
        verify(
          body({
            outputs: [
              output({
                address: vaultAddress,
                lovelace: 2_000_000,
                hasAssets: true,
              }),
              output({
                address: vaultAddress,
                lovelace: 1_500_000,
                extras: [[cborUint(2), cborBytes(new Uint8Array(32))]],
              }),
            ],
          })
        )
      ).not.toThrow()
    })

    it('legacy array-shaped outputs', () => {
      expect(() =>
        verify(
          body({
            outputs: [
              legacyOutput({ address: depositAddress, lovelace: 40_000_000 }),
              legacyOutput({ address: vaultAddress, lovelace: 3_000_000 }),
            ],
          })
        )
      ).not.toThrow()
    })

    it('every field a plain payment may carry', () => {
      expect(() =>
        verify(
          body({
            outputs: [vaultChange],
            extraFields: [
              [3, cborUint(190_000_000)],
              [7, cborBytes(new Uint8Array(32).fill(0xaa))],
              [8, cborUint(189_000_000)],
              [15, cborUint(1)],
            ],
          })
        )
      ).not.toThrow()
    })

    it('collections wrapped in the Conway set tag', () => {
      const taggedBody = cborMap([
        [cborUint(0), concat([setTag, inputs])],
        [cborUint(1), concat([setTag, cborArray([vaultChange])])],
        [cborUint(2), cborUint(170_000)],
      ])

      expect(() => verify(taggedBody)).not.toThrow()
    })

    it('a fee at the ceiling', () => {
      expect(() => verify(body({ outputs: [vaultChange], fee: 2_000_000 }))).not.toThrow()
    })

    it('lovelace amounts beyond 32 bits', () => {
      // 5_000_000_000 lovelace as an 8-byte CBOR uint.
      const wideLovelace = fromHex('1b000000012a05f200')
      const wideOutput = (address: Uint8Array) =>
        cborMap([
          [cborUint(0), cborBytes(address)],
          [cborUint(1), wideLovelace],
        ])
      const wideBody = body({
        outputs: [wideOutput(depositAddress), wideOutput(vaultAddress)],
      })

      expect(() => verify(wideBody, 5_000_000_000n)).not.toThrow()
      expect(() => verify(wideBody, 4_999_999_999n)).toThrow(/exceeds the quoted swap amount/)
    })

    it('the captured transaction shape, re-keyed to the vault', () => {
      expect(() =>
        verify(
          body({
            outputs: [
              output({ address: depositAddress, lovelace: 45_436_600 }),
              output({ address: vaultAddress, lovelace: 35_669_751 }),
            ],
            fee: 166_029,
            extraFields: [[3, cborUint(187_845_819)]],
          })
        )
      ).not.toThrow()
    })
  })

  describe('refuses', () => {
    it('the captured transaction for a vault it does not pay back to', () => {
      const { length } = capturedEnvelope
      const capturedBody = capturedEnvelope.subarray(1, length - 3)

      expect(() => verify(capturedBody, 100_000_000n)).toThrow(/more than one output outside this vault/)
    })

    it('a deposit above the quote', () => {
      expect(() =>
        verify(
          body({
            outputs: [output({ address: depositAddress, lovelace: 45_500_001 }), vaultChange],
          })
        )
      ).toThrow(/exceeds the quoted swap amount/)
    })

    it('native tokens on the deposit', () => {
      expect(() =>
        verify(
          body({
            outputs: [
              output({
                address: depositAddress,
                lovelace: 2_000_000,
                hasAssets: true,
              }),
              vaultChange,
            ],
          })
        )
      ).toThrow(/plain ADA only/)
    })

    it('a datum on the deposit', () => {
      expect(() =>
        verify(
          body({
            outputs: [
              output({
                address: depositAddress,
                lovelace: 2_000_000,
                extras: [[cborUint(2), cborBytes(new Uint8Array(32))]],
              }),
              vaultChange,
            ],
          })
        )
      ).toThrow(/plain ADA only/)

      expect(() =>
        verify(
          body({
            outputs: [
              legacyOutput({ address: depositAddress, lovelace: 2_000_000 }, [cborBytes(new Uint8Array(32))]),
              vaultChange,
            ],
          })
        )
      ).toThrow(/plain ADA only/)
    })

    it('more than one output outside the vault', () => {
      expect(() =>
        verify(
          body({
            outputs: [
              output({ address: depositAddress, lovelace: 1_000_000 }),
              output({
                address: new Uint8Array(29).fill(0x77),
                lovelace: 1_000_000,
              }),
              vaultChange,
            ],
          })
        )
      ).toThrow(/more than one output outside this vault/)
    })

    it('a base address sharing the vault payment credential', () => {
      // Header 0x01 + the vault key hash + a stake credential: spendable by the
      // vault key, but not the address Vultisig derives or tracks.
      const baseAddress = concat([Uint8Array.of(0x01), vaultAddress.subarray(1), new Uint8Array(28).fill(0x44)])

      expect(() =>
        verify(
          body({
            outputs: [
              output({ address: depositAddress, lovelace: 1_000_000 }),
              output({ address: baseAddress, lovelace: 4_000_000 }),
            ],
          })
        )
      ).toThrow(/more than one output outside this vault/)
    })

    it('a body with no outputs', () => {
      expect(() => verify(body({}))).toThrow(/has no outputs/)
    })

    it('a body with no fee', () => {
      expect(() =>
        verify(
          cborMap([
            [cborUint(0), inputs],
            [cborUint(1), cborArray([vaultChange])],
          ])
        )
      ).toThrow(/has no fee/)
    })

    it('a fee above the ceiling', () => {
      expect(() => verify(body({ outputs: [vaultChange], fee: 2_000_001 }))).toThrow(/exceeds the 2000000 ceiling/)
    })

    it.each([
      [4, 'certificates'],
      [5, 'withdrawals'],
      [6, 'protocol update'],
      [9, 'mint'],
      [11, 'script data hash'],
      [13, 'collateral'],
      [14, 'required signers'],
      [16, 'collateral return'],
      [17, 'total collateral'],
      [18, 'reference inputs'],
      [19, 'voting procedures'],
      [20, 'proposal procedures'],
      [21, 'treasury value'],
      [22, 'treasury donation'],
    ])('body field %i (%s)', key => {
      expect(() => verify(body({ outputs: [vaultChange], extraFields: [[key, cborArray([])]] }))).toThrow(
        new RegExp(`carries field ${key}, which a plain payment never uses`)
      )
    })

    it('a repeated body field', () => {
      expect(() =>
        verify(
          body({
            outputs: [vaultChange],
            extraFields: [[2, cborUint(170_000)]],
          })
        )
      ).toThrow(/repeats field 2/)
      expect(() =>
        verify(
          body({
            outputs: [vaultChange],
            extraFields: [[1, cborArray([vaultChange])]],
          })
        )
      ).toThrow(/repeats field 1/)
    })

    it('an output that repeats its address', () => {
      const ambiguousOutput = cborMap([
        [cborUint(0), cborBytes(depositAddress)],
        [cborUint(1), cborUint(40_000_000)],
        [cborUint(0), cborBytes(vaultAddress)],
      ])

      expect(() => verify(body({ outputs: [ambiguousOutput] }))).toThrow(/repeats its address/)
    })

    it('trailing bytes after the body', () => {
      expect(() => verify(concat([body({ outputs: [vaultChange] }), Uint8Array.of(0x00)]))).toThrow(/trailing bytes/)
    })

    it('a truncated body', () => {
      const bodyCbor = body({ outputs: [vaultChange] })

      expect(() => verify(bodyCbor.subarray(0, bodyCbor.length - 4))).toThrow()
    })

    it('a body that is not a map', () => {
      expect(() => verify(cborArray([inputs]))).toThrow(/major type 4 where 5 was expected/)
    })

    it('a vault key of the wrong length', () => {
      expect(() =>
        verifySwapKitCardanoBody({
          body: body({ outputs: [vaultChange] }),
          fromAmount: 0n,
          vaultPublicKey: new Uint8Array(33),
        })
      ).toThrow(/must be 32 bytes/)
    })
  })
})

describe('getSwapKitCardanoPrebuiltSigningInput', () => {
  const envelope = envelopeOf(
    body({
      outputs: [output({ address: depositAddress, lovelace: 40_000_000 }), vaultChange],
    })
  )

  it('returns the envelope untouched once the body passes', () => {
    expect(
      hex(
        getSwapKitCardanoPrebuiltSigningInput({
          swapKitPayload: swapKitPayloadOf(envelope),
          vaultPublicKey,
        })
      )
    ).toBe(hex(envelope))
  })

  it('bounds the deposit by the quoted amount', () => {
    expect(() =>
      getSwapKitCardanoPrebuiltSigningInput({
        swapKitPayload: swapKitPayloadOf(envelope, { fromAmount: '39999999' }),
        vaultPublicKey,
      })
    ).toThrow(/exceeds the quoted swap amount/)
  })

  it('refuses a quoted amount that is not a whole number', () => {
    expect(() =>
      getSwapKitCardanoPrebuiltSigningInput({
        swapKitPayload: swapKitPayloadOf(envelope, { fromAmount: '45.5' }),
        vaultPublicKey,
      })
    ).toThrow(/swap amount is invalid/)
  })

  it('refuses a swap whose source is not ADA, since the quote is then not in lovelace', () => {
    const tokenSwap = swapKitPayloadOf(envelope, {
      fromCoin: create(CoinSchema, {
        chain: Chain.Cardano,
        ticker: 'USDM',
        contractAddress: 'c48cbb3d',
        decimals: 6,
      }),
    })
    const noSourceCoin = create(SwapKitSwapPayloadSchema, {
      fromAmount: '45500000',
      txType: 'CARDANO_PREBUILT',
      txPayload: envelope,
    })

    expect(() =>
      getSwapKitCardanoPrebuiltSigningInput({
        swapKitPayload: tokenSwap,
        vaultPublicKey,
      })
    ).toThrow(/can only swap from ADA/)
    expect(() =>
      getSwapKitCardanoPrebuiltSigningInput({
        swapKitPayload: noSourceCoin,
        vaultPublicKey,
      })
    ).toThrow(/can only swap from ADA/)
  })
})

describe('buildSignedSwapKitCardanoTx', () => {
  const signature = new Uint8Array(64).fill(0xcd)
  const witnessSet = `a10081825820${hex(vaultPublicKey)}5840${hex(signature)}`

  it('splices the vkey witness in and keeps the body, is_valid and auxiliary data verbatim', () => {
    const bodyCbor = body({
      outputs: [output({ address: depositAddress, lovelace: 40_000_000 }), vaultChange],
    })
    // A non-empty witness set and non-default trailing items, to show that
    // item 1 is replaced while items 2 and 3 are copied rather than rebuilt.
    const staleWitnessSet = fromHex('a10080')
    const auxData = cborMap([[cborUint(674), cborMap([])]])
    const envelope = concat([Uint8Array.of(0x84), bodyCbor, staleWitnessSet, isValidTrue, auxData])

    const signed = buildSignedSwapKitCardanoTx({
      envelope,
      swapKitPayload: swapKitPayloadOf(envelope),
      vaultPublicKey,
      signature,
    })

    expect(hex(signed)).toBe(`84${hex(bodyCbor)}${witnessSet}f5${hex(auxData)}`)
  })

  it('validates the body again before assembling', () => {
    const envelope = envelopeOf(
      body({
        outputs: [output({ address: depositAddress, lovelace: 45_500_001 })],
      })
    )

    expect(() =>
      buildSignedSwapKitCardanoTx({
        envelope,
        swapKitPayload: swapKitPayloadOf(envelope),
        vaultPublicKey,
        signature,
      })
    ).toThrow(/exceeds the quoted swap amount/)
  })

  it('refuses a signature of the wrong length', () => {
    const envelope = envelopeOf(body({ outputs: [vaultChange] }))

    expect(() =>
      buildSignedSwapKitCardanoTx({
        envelope,
        swapKitPayload: swapKitPayloadOf(envelope),
        vaultPublicKey,
        signature: new Uint8Array(63),
      })
    ).toThrow(/must be 64 bytes/)
  })
})

describe('keysign pipeline', () => {
  let walletCore: WalletCore

  beforeAll(async () => {
    walletCore = await initWasm()
  })

  /** WalletCore's extended Cardano key, built the way `getPublicKey` builds it for a vault. */
  const cardanoPublicKey = (keyByte: number) => {
    const privateKey = walletCore.PrivateKey.createWithData(new Uint8Array(32).fill(keyByte))
    const spendingKey = new Uint8Array(privateKey.getPublicKeyEd25519().data())
    const chainCode = new Uint8Array(32).fill(0x02)
    const publicKey = walletCore.PublicKey.createWithData(
      concat([spendingKey, spendingKey, chainCode, chainCode]),
      walletCore.PublicKeyType.ed25519Cardano
    )

    return { privateKey, spendingKey, publicKey }
  }

  const setup = () => {
    const vault = cardanoPublicKey(0x01)
    const bodyCbor = body({
      outputs: [
        output({ address: depositAddress, lovelace: 45_436_600 }),
        output({
          address: enterpriseAddress(vault.spendingKey),
          lovelace: 35_669_751,
        }),
      ],
      fee: 166_029,
      extraFields: [[3, cborUint(187_845_819)]],
    })
    const envelope = envelopeOf(bodyCbor)
    const coin = create(CoinSchema, {
      chain: Chain.Cardano,
      ticker: 'ADA',
      address: deriveCardanoAddress({ publicKey: vault.publicKey, walletCore }),
      decimals: 6,
      isNativeToken: true,
      hexPublicKey: hex(vault.spendingKey),
    })
    const keysignPayload = create(KeysignPayloadSchema, {
      coin,
      // SwapKit's declared target, which is not where the body deposits.
      toAddress: deriveCardanoAddress({
        publicKey: cardanoPublicKey(0x07).publicKey,
        walletCore,
      }),
      toAmount: '45500000',
      swapPayload: {
        case: 'swapkitSwapPayload',
        value: create(SwapKitSwapPayloadSchema, {
          fromCoin: coin,
          fromAmount: '45500000',
          txType: 'CARDANO_PREBUILT',
          txPayload: envelope,
        }),
      },
    })

    return { vault, bodyCbor, envelope, keysignPayload }
  }

  it('signs the SwapKit body verbatim and assembles a transaction with the same id', async () => {
    const { vault, bodyCbor, envelope, keysignPayload } = setup()

    const [txInputData] = await getEncodedSigningInputs({
      keysignPayload,
      walletCore,
      publicKey: vault.publicKey,
    })
    expect(hex(txInputData)).toBe(hex(envelope))

    const hashes = getPreSigningHashes({
      walletCore,
      chain: Chain.Cardano,
      txInputData,
      keysignPayload,
    })
    expect(hashes.map(hex)).toEqual([hex(blake2b(bodyCbor, { dkLen: 32 }))])

    const [hash] = hashes
    const signature = vault.privateKey.sign(hash, walletCore.Curve.ed25519)
    const compiled = compileTx({
      publicKey: vault.publicKey,
      txInputData,
      signatures: {
        [hex(hash)]: {
          msg: '',
          r: hex(signature.slice(0, 32)),
          s: hex(signature.slice(32, 64)),
          der_signature: '',
        },
      },
      chain: Chain.Cardano,
      walletCore,
      keysignPayload,
    })
    const signingOutput = TW.Cardano.Proto.SigningOutput.decode(compiled)

    expect(hex(signingOutput.txId)).toBe(hex(hash))
    expect(hex(signingOutput.encoded)).toBe(
      `84${hex(bodyCbor)}a10081825820${hex(vault.spendingKey)}5840${hex(signature)}f5f6`
    )
    expect(hex(cardanoTxBodyHash(hex(signingOutput.encoded)))).toBe(hex(hash))
  })

  it('refuses to produce a signing input for a vault the transaction does not pay back to', async () => {
    const { keysignPayload } = setup()

    await expect(
      getEncodedSigningInputs({
        keysignPayload,
        walletCore,
        publicKey: cardanoPublicKey(0x05).publicKey,
      })
    ).rejects.toThrow(/more than one output outside this vault/)
  })

  it('refuses to produce a signing input without the vault key to validate against', async () => {
    const { keysignPayload } = setup()

    await expect(getEncodedSigningInputs({ keysignPayload, walletCore })).rejects.toThrow(/publicKey is required/)
  })

  it('refuses to compile a signature made by another key', async () => {
    const { vault, keysignPayload } = setup()
    const [txInputData] = await getEncodedSigningInputs({
      keysignPayload,
      walletCore,
      publicKey: vault.publicKey,
    })
    const [hash] = getPreSigningHashes({
      walletCore,
      chain: Chain.Cardano,
      txInputData,
      keysignPayload,
    })
    const signature = cardanoPublicKey(0x05).privateKey.sign(hash, walletCore.Curve.ed25519)

    expect(() =>
      compileTx({
        publicKey: vault.publicKey,
        txInputData,
        signatures: {
          [hex(hash)]: {
            msg: '',
            r: hex(signature.slice(0, 32)),
            s: hex(signature.slice(32, 64)),
            der_signature: '',
          },
        },
        chain: Chain.Cardano,
        walletCore,
        keysignPayload,
      })
    ).toThrow(/Signature verification failed/)
  })
})
