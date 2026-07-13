import { Buffer } from 'buffer'
import { readFileSync } from 'fs'

import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { type WalletCore, initWasm } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import {
  rippleIssuedCurrencyDecimals,
  rippleTokenId,
  toXrplCurrencyCode,
} from '@vultisig/core-chain/chains/ripple/issuedCurrency'
import { RippleSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { beforeAll, describe, expect, it } from 'vitest'

import { getPreSigningHashes } from '../../../tx/preSigningHashes'
import { getEncodedSigningInputs } from '../index'
import { getRippleSigningInputs } from './ripple'

// getRippleSigningInputs does not touch walletCore.
const walletCore = {} as unknown as WalletCore

const ACCOUNT = 'rExampleAccountAddressForTests1234567'
const RLUSD_ISSUER = 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De'
// Dummy 33-byte secp256k1 public key (hex) for getKeysignTwPublicKey.
const HEX_PUBLIC_KEY = `02${'ab'.repeat(32)}`

const makeRippleSpecific = (destinationTag?: number) => {
  const rippleSpecific = create(RippleSpecificSchema, {
    sequence: 100n,
    gas: 15n,
    lastLedgerSequence: 200n,
  })

  // Set this optional scalar directly so its field presence is explicit in this
  // resolver fixture.
  if (destinationTag !== undefined) rippleSpecific.destinationTag = destinationTag

  return rippleSpecific
}

const buildTrustSetPayload = (toAmount: string) =>
  create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: Chain.Ripple,
      ticker: 'RLUSD',
      address: ACCOUNT,
      decimals: rippleIssuedCurrencyDecimals,
      isNativeToken: false,
      contractAddress: rippleTokenId({
        currency: 'RLUSD',
        issuer: RLUSD_ISSUER,
      }),
      hexPublicKey: HEX_PUBLIC_KEY,
    }),
    toAddress: RLUSD_ISSUER,
    toAmount,
    blockchainSpecific: { case: 'rippleSpecific', value: makeRippleSpecific() },
  })

const buildPaymentPayload = ({
  destinationTag,
  memo,
}: {
  destinationTag?: number
  memo?: string
} = {}) =>
  create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: Chain.Ripple,
      ticker: 'XRP',
      address: ACCOUNT,
      decimals: 6,
      isNativeToken: true,
      hexPublicKey: HEX_PUBLIC_KEY,
    }),
    toAddress: 'rDestinationAddressForTests9876543210',
    toAmount: '1000000',
    memo,
    blockchainSpecific: {
      case: 'rippleSpecific',
      value: makeRippleSpecific(destinationTag),
    },
  })

describe('getRippleSigningInputs -- TrustSet build path (issued currency)', () => {
  it('builds an OperationTrustSet with the on-ledger currency code, issuer and value', async () => {
    // 1.5 RLUSD at 15 decimals.
    const [input] = await getRippleSigningInputs({
      keysignPayload: buildTrustSetPayload('1500000000000000'),
      walletCore,
    })

    expect(input.opTrustSet).toBeTruthy()
    expect(input.opPayment).toBeFalsy()

    const limit = input.opTrustSet?.limitAmount
    expect(limit?.currency).toBe(toXrplCurrencyCode('RLUSD'))
    // RLUSD is non-standard (>3 chars) so it must be the 160-bit hex form.
    expect(limit?.currency).toBe('524C555344000000000000000000000000000000')
    expect(limit?.issuer).toBe(RLUSD_ISSUER)
    expect(limit?.value).toBe('1.5')
  })

  it('normalizes an unencoded non-standard currency stored in contractAddress before signing', async () => {
    // Defense-in-depth: a `contractAddress` built without going through
    // `rippleTokenId()` (e.g. a raw "RLUSD.<issuer>" id) must still resolve to
    // the on-ledger 40-char hex form rather than being forwarded verbatim.
    const payload = buildTrustSetPayload('1000000000000000')
    payload.coin!.contractAddress = `RLUSD.${RLUSD_ISSUER}`

    const [input] = await getRippleSigningInputs({
      keysignPayload: payload,
      walletCore,
    })

    expect(input.opTrustSet?.limitAmount?.currency).toBe('524C555344000000000000000000000000000000')
    expect(input.opTrustSet?.limitAmount?.issuer).toBe(RLUSD_ISSUER)
  })

  it('formats whole-number limits without a fractional part', async () => {
    const [input] = await getRippleSigningInputs({
      keysignPayload: buildTrustSetPayload('1000000000000000'),
      walletCore,
    })

    expect(input.opTrustSet?.limitAmount?.value).toBe('1')
  })

  it('carries the network fee and sequence through unchanged', async () => {
    const [input] = await getRippleSigningInputs({
      keysignPayload: buildTrustSetPayload('1000000000000000'),
      walletCore,
    })

    expect(input.fee.toString()).toBe('15')
    expect(input.sequence).toBe(100)
    expect(input.lastLedgerSequence).toBe(200)
    expect(input.account).toBe(ACCOUNT)
  })

  it('native XRP still builds a Payment, never a TrustSet', async () => {
    const [input] = await getRippleSigningInputs({
      keysignPayload: buildPaymentPayload(),
      walletCore,
    })

    expect(input.opPayment).toBeTruthy()
    expect(input.opTrustSet).toBeFalsy()
  })

  it('uses the first-class destination tag when no independent memo is supplied', async () => {
    const [input] = await getRippleSigningInputs({
      keysignPayload: buildPaymentPayload({ destinationTag: 12345 }),
      walletCore,
    })

    expect(input.opPayment?.destinationTag?.toString()).toBe('12345')
    expect(input.rawJson).toBeFalsy()
  })

  it('preserves a distinct memo alongside the first-class destination tag in raw JSON', async () => {
    const [input] = await getRippleSigningInputs({
      keysignPayload: buildPaymentPayload({
        destinationTag: 12345,
        memo: 'invoice 67890',
      }),
      walletCore,
    })

    expect(input.opPayment).toBeFalsy()
    expect(JSON.parse(input.rawJson!)).toMatchObject({
      DestinationTag: 12345,
      Memos: [{ Memo: { MemoData: '696E766F696365203637383930' } }],
    })
  })

  it('preserves a distinct numeric memo alongside the first-class tag', async () => {
    const [input] = await getRippleSigningInputs({
      keysignPayload: buildPaymentPayload({
        destinationTag: 12345,
        memo: '67890',
      }),
      walletCore,
    })

    expect(JSON.parse(input.rawJson!)).toMatchObject({
      DestinationTag: 12345,
      Memos: [{ Memo: { MemoData: '3637383930' } }],
    })
  })

  it('treats an equal numeric memo as the legacy tag carrier', async () => {
    const [input] = await getRippleSigningInputs({
      keysignPayload: buildPaymentPayload({
        destinationTag: 12345,
        memo: '12345',
      }),
      walletCore,
    })

    expect(input.opPayment?.destinationTag?.toString()).toBe('12345')
    expect(input.rawJson).toBeFalsy()
  })

  it('produces the same signing input when a legacy peer drops the first-class tag field', async () => {
    const payload = buildPaymentPayload({
      destinationTag: 12345,
      memo: '12345',
    })
    const serialized = toBinary(KeysignPayloadSchema, payload)
    const modernPayload = fromBinary(KeysignPayloadSchema, serialized)
    const legacyPayload = fromBinary(KeysignPayloadSchema, serialized)

    if (legacyPayload.blockchainSpecific.case === 'rippleSpecific') {
      // Simulate an older schema that cannot read optional field 4. The memo
      // remains available as the canonical legacy carrier.
      legacyPayload.blockchainSpecific.value.destinationTag = undefined
    }

    const [modernInput] = await getRippleSigningInputs({
      keysignPayload: modernPayload,
      walletCore,
    })
    const [legacyInput] = await getRippleSigningInputs({
      keysignPayload: legacyPayload,
      walletCore,
    })

    expect(modernPayload.memo).toBe('12345')
    expect(legacyInput).toEqual(modernInput)
    expect(legacyInput.opPayment?.destinationTag?.toString()).toBe('12345')
  })

  it('uses a canonical numeric memo as a legacy tag only when the field is absent', async () => {
    const [input] = await getRippleSigningInputs({
      keysignPayload: buildPaymentPayload({ memo: '4294967295' }),
      walletCore,
    })

    expect(input.opPayment?.destinationTag?.toString()).toBe('4294967295')
    expect(input.rawJson).toBeFalsy()
  })

  it('preserves the legacy zero DestinationTag carrier', async () => {
    const [input] = await getRippleSigningInputs({
      keysignPayload: buildPaymentPayload({ memo: '0' }),
      walletCore,
    })

    expect(input.opPayment?.destinationTag?.toString()).toBe('0')
    expect(input.rawJson).toBeFalsy()
  })

  it.each(['001', '4294967296'])('keeps non-canonical legacy numeric memo %s as a memo', async memo => {
    const [input] = await getRippleSigningInputs({
      keysignPayload: buildPaymentPayload({ memo }),
      walletCore,
    })

    expect(input.opPayment).toBeFalsy()
    expect(JSON.parse(input.rawJson!).Memos[0].Memo.MemoData).toBe(
      Buffer.from(memo, 'utf8').toString('hex').toUpperCase()
    )
  })

  it('accepts first-class DestinationTag zero', async () => {
    const [input] = await getRippleSigningInputs({
      keysignPayload: buildPaymentPayload({ destinationTag: 0 }),
      walletCore,
    })

    expect(input.opPayment?.destinationTag?.toString()).toBe('0')
  })

  it.each([-1, 4294967296, 1.5])('rejects an invalid first-class destination tag: %s', destinationTag => {
    expect(() =>
      getRippleSigningInputs({
        keysignPayload: buildPaymentPayload({ destinationTag }),
        walletCore,
      })
    ).toThrow('Invalid XRP destination tag')
  })
})

describe('getRippleSigningInputs -- rawJson build path (dApp-supplied tx)', () => {
  const offerCreateJson = JSON.stringify({
    TransactionType: 'OfferCreate',
    Account: ACCOUNT,
    TakerGets: '10000000',
    TakerPays: {
      currency: '524C555344000000000000000000000000000000',
      issuer: RLUSD_ISSUER,
      value: '5',
    },
    Fee: '15',
    Sequence: 100,
    LastLedgerSequence: 200,
  })

  const buildSignRipplePayload = () => {
    const payload = buildPaymentPayload()
    payload.signData = {
      case: 'signRipple',
      value: {
        $typeName: 'vultisig.keysign.v1.SignRipple',
        rawJson: offerCreateJson,
      },
    }
    return payload
  }

  it('forwards the raw transaction JSON verbatim and builds neither Payment nor TrustSet', async () => {
    const [input] = await getRippleSigningInputs({
      keysignPayload: buildSignRipplePayload(),
      walletCore,
    })

    expect(input.rawJson).toBe(offerCreateJson)
    expect(input.opPayment).toBeFalsy()
    expect(input.opTrustSet).toBeFalsy()
  })

  it('still carries the signer public key so WalletCore can sign', async () => {
    const [input] = await getRippleSigningInputs({
      keysignPayload: buildSignRipplePayload(),
      walletCore,
    })

    expect(input.publicKey.length).toBeGreaterThan(0)
  })

  it('throws on an empty rawJson instead of emitting an operation-less input', () => {
    const payload = buildSignRipplePayload()
    payload.signData = {
      case: 'signRipple',
      value: { $typeName: 'vultisig.keysign.v1.SignRipple', rawJson: '' },
    }

    expect(() => getRippleSigningInputs({ keysignPayload: payload, walletCore })).toThrow(/missing rawJson/)
  })

  it('rejects a rawJson whose Account is not the signing vault (fail closed)', () => {
    // A malicious initiator could present the reviewed metadata for this vault
    // while embedding a transaction that spends a different account. The signer
    // must refuse rather than sign someone else's transaction.
    const payload = buildSignRipplePayload()
    payload.signData = {
      case: 'signRipple',
      value: {
        $typeName: 'vultisig.keysign.v1.SignRipple',
        rawJson: JSON.stringify({
          TransactionType: 'Payment',
          Account: 'rAttackerAccount000000000000000000',
          Destination: 'rElsewhere00000000000000000000000',
          Amount: '999999999',
        }),
      },
    }

    expect(() => getRippleSigningInputs({ keysignPayload: payload, walletCore })).toThrow(/Account does not match/)
  })

  it('rejects a rawJson that carries no Account at all', () => {
    const payload = buildSignRipplePayload()
    payload.signData = {
      case: 'signRipple',
      value: {
        $typeName: 'vultisig.keysign.v1.SignRipple',
        rawJson: JSON.stringify({
          TransactionType: 'OfferCancel',
          OfferSequence: 7,
        }),
      },
    }

    expect(() => getRippleSigningInputs({ keysignPayload: payload, walletCore })).toThrow(/Account does not match/)
  })

  it('rejects a same-account Payment whose Destination diverges from the reviewed toAddress', () => {
    // The Account check alone is not enough: the initiator can present
    // reviewed metadata (toAddress=A / toAmount=1 XRP) while rawJson signs a
    // Payment from the SAME vault account to a different destination. The
    // reviewed metadata must bind to the signed bytes.
    const payload = buildPaymentPayload()
    payload.signData = {
      case: 'signRipple',
      value: {
        $typeName: 'vultisig.keysign.v1.SignRipple',
        rawJson: JSON.stringify({
          TransactionType: 'Payment',
          Account: ACCOUNT,
          Destination: 'rAttackerDestination00000000000000',
          Amount: payload.toAmount,
        }),
      },
    }

    expect(() => getRippleSigningInputs({ keysignPayload: payload, walletCore })).toThrow(/Destination does not match/)
  })

  it('rejects a same-account Payment whose Amount diverges from the reviewed toAmount', () => {
    const payload = buildPaymentPayload()
    payload.signData = {
      case: 'signRipple',
      value: {
        $typeName: 'vultisig.keysign.v1.SignRipple',
        rawJson: JSON.stringify({
          TransactionType: 'Payment',
          Account: ACCOUNT,
          Destination: payload.toAddress,
          Amount: '999999999999',
        }),
      },
    }

    expect(() => getRippleSigningInputs({ keysignPayload: payload, walletCore })).toThrow(/Amount does not match/)
  })

  it('rejects a same-account Payment that omits Amount entirely', () => {
    const payload = buildPaymentPayload()
    payload.signData = {
      case: 'signRipple',
      value: {
        $typeName: 'vultisig.keysign.v1.SignRipple',
        rawJson: JSON.stringify({
          TransactionType: 'Payment',
          Account: ACCOUNT,
          Destination: payload.toAddress,
        }),
      },
    }

    expect(() => getRippleSigningInputs({ keysignPayload: payload, walletCore })).toThrow(/Amount does not match/)
  })

  it('forwards a Payment rawJson whose Destination and Amount match the reviewed metadata', async () => {
    const payload = buildPaymentPayload()
    const paymentJson = JSON.stringify({
      TransactionType: 'Payment',
      Account: ACCOUNT,
      Destination: payload.toAddress,
      Amount: payload.toAmount,
      Fee: '15',
      Sequence: 100,
      LastLedgerSequence: 200,
    })
    payload.signData = {
      case: 'signRipple',
      value: {
        $typeName: 'vultisig.keysign.v1.SignRipple',
        rawJson: paymentJson,
      },
    }

    const [input] = await getRippleSigningInputs({
      keysignPayload: payload,
      walletCore,
    })

    expect(input.rawJson).toBe(paymentJson)
    expect(input.opPayment).toBeFalsy()
  })

  it('rejects an issued-currency Amount object when the reviewed coin is native XRP', () => {
    // Metadata reviewed as a 1 XRP send, but rawJson pays out an IOU instead.
    const payload = buildPaymentPayload()
    payload.signData = {
      case: 'signRipple',
      value: {
        $typeName: 'vultisig.keysign.v1.SignRipple',
        rawJson: JSON.stringify({
          TransactionType: 'Payment',
          Account: ACCOUNT,
          Destination: payload.toAddress,
          Amount: { currency: 'RLUSD', issuer: RLUSD_ISSUER, value: '100000' },
        }),
      },
    }

    expect(() => getRippleSigningInputs({ keysignPayload: payload, walletCore })).toThrow(/Amount does not match/)
  })

  it('binds an issued-currency Payment to the reviewed currency, issuer and value', async () => {
    // 1.5 RLUSD reviewed; rawJson delivers the same amount with an equivalent
    // value spelling ("1.50") and the human ticker instead of the hex code.
    const payload = buildTrustSetPayload('1500000000000000')
    payload.toAddress = 'rDestinationAddressForTests9876543210'
    const paymentJson = JSON.stringify({
      TransactionType: 'Payment',
      Account: ACCOUNT,
      Destination: payload.toAddress,
      Amount: { currency: 'RLUSD', issuer: RLUSD_ISSUER, value: '1.50' },
    })
    payload.signData = {
      case: 'signRipple',
      value: {
        $typeName: 'vultisig.keysign.v1.SignRipple',
        rawJson: paymentJson,
      },
    }

    const [input] = await getRippleSigningInputs({
      keysignPayload: payload,
      walletCore,
    })

    expect(input.rawJson).toBe(paymentJson)
    expect(input.opTrustSet).toBeFalsy()
  })

  it('rejects an issued-currency Payment whose value diverges from the reviewed toAmount', () => {
    const payload = buildTrustSetPayload('1500000000000000')
    payload.toAddress = 'rDestinationAddressForTests9876543210'
    payload.signData = {
      case: 'signRipple',
      value: {
        $typeName: 'vultisig.keysign.v1.SignRipple',
        rawJson: JSON.stringify({
          TransactionType: 'Payment',
          Account: ACCOUNT,
          Destination: payload.toAddress,
          Amount: { currency: 'RLUSD', issuer: RLUSD_ISSUER, value: '150' },
        }),
      },
    }

    expect(() => getRippleSigningInputs({ keysignPayload: payload, walletCore })).toThrow(/Amount does not match/)
  })

  it('still lets a non-Payment rawJson through on the Account check alone (OfferCreate)', async () => {
    // Offers cannot be expressed by toAddress/toAmount, so the metadata
    // binding must not break them — only the Account gate applies.
    const [input] = await getRippleSigningInputs({
      keysignPayload: buildSignRipplePayload(),
      walletCore,
    })

    expect(input.rawJson).toBe(offerCreateJson)
  })

  it('throws on a malformed (non-JSON) rawJson', () => {
    const payload = buildSignRipplePayload()
    payload.signData = {
      case: 'signRipple',
      value: {
        $typeName: 'vultisig.keysign.v1.SignRipple',
        rawJson: 'not json',
      },
    }

    expect(() => getRippleSigningInputs({ keysignPayload: payload, walletCore })).toThrow(/not valid JSON/)
  })
})

type RippleInteropVector = {
  input: {
    address: string
    hexPublicKey: string
    toAddress: string
    toAmount: string
    destinationTag: string
    sequence: string
    fee: string
    lastLedgerSequence: string
  }
  expected: { serializedSigningInputHex: string; preSigningHashHex: string }
}

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')
const vector = JSON.parse(
  readFileSync(new URL('../fixtures/ripple-interop-vector.test.json', import.meta.url), 'utf8')
) as RippleInteropVector

const buildInteropPayload = () =>
  create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: Chain.Ripple,
      ticker: 'XRP',
      address: vector.input.address,
      contractAddress: '',
      decimals: 6,
      isNativeToken: true,
      hexPublicKey: vector.input.hexPublicKey,
    }),
    toAddress: vector.input.toAddress,
    toAmount: vector.input.toAmount,
    memo: vector.input.destinationTag,
    blockchainSpecific: {
      case: 'rippleSpecific',
      value: create(RippleSpecificSchema, {
        sequence: BigInt(vector.input.sequence),
        gas: BigInt(vector.input.fee),
        lastLedgerSequence: BigInt(vector.input.lastLedgerSequence),
      }),
    },
  })

describe('getRippleSigningInputs interop vector', () => {
  let interopWalletCore: WalletCore
  beforeAll(async () => {
    interopWalletCore = await initWasm()
  })

  it('pins destination-tag payment fields for the shared vector', async () => {
    const [input] = await getRippleSigningInputs({
      keysignPayload: buildInteropPayload(),
      walletCore: interopWalletCore,
    })
    expect(input.account).toBe(vector.input.address)
    expect(input.opPayment?.destination).toBe(vector.input.toAddress)
    expect(input.opPayment?.amount.toString()).toBe(vector.input.toAmount)
    expect(input.opPayment?.destinationTag?.toString()).toBe(vector.input.destinationTag)
    expect(input.sequence).toBe(Number(vector.input.sequence))
    expect(input.fee.toString()).toBe(vector.input.fee)
    expect(input.lastLedgerSequence).toBe(Number(vector.input.lastLedgerSequence))
  })

  it('keeps serialized signing bytes and pre-signing hash stable', async () => {
    const [txInputData] = await getEncodedSigningInputs({
      keysignPayload: buildInteropPayload(),
      walletCore: interopWalletCore,
    })
    const [preSigningHash] = getPreSigningHashes({
      walletCore: interopWalletCore,
      chain: Chain.Ripple,
      txInputData,
    })
    expect(hex(txInputData)).toBe(vector.expected.serializedSigningInputHex)
    expect(hex(preSigningHash)).toBe(vector.expected.preSigningHashHex)
  })
})
