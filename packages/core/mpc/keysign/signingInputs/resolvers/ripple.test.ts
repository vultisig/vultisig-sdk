import { Buffer } from 'buffer'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'

import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { TW, type WalletCore, initWasm } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import {
  rippleIssuedCurrencyDecimals,
  rippleTokenId,
  toXrplCurrencyCode,
} from '@vultisig/core-chain/chains/ripple/issuedCurrency'
import {
  RippleSpecificSchema,
  TransactionType,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { beforeAll, describe, expect, it } from 'vitest'
import { decode, encodeForSigning } from 'ripple-binary-codec'

import { getPreSigningHashes } from '../../../tx/preSigningHashes'
import { getEncodedSigningInputs } from '../index'
import { getRippleSigningInputs } from './ripple'

// getRippleSigningInputs does not touch walletCore.
const walletCore = {} as unknown as WalletCore

const ACCOUNT = 'rExampleAccountAddressForTests1234567'
const RLUSD_ISSUER = 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De'
// Dummy 33-byte secp256k1 public key (hex) for getKeysignTwPublicKey.
const HEX_PUBLIC_KEY = `02${'ab'.repeat(32)}`

const makeRippleSpecific = (
  destinationTag?: number,
  transactionType: TransactionType = TransactionType.UNSPECIFIED
) => {
  const rippleSpecific = create(RippleSpecificSchema, {
    sequence: 100n,
    gas: 15n,
    lastLedgerSequence: 200n,
    transactionType,
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
    blockchainSpecific: {
      case: 'rippleSpecific',
      value: makeRippleSpecific(undefined, TransactionType.RIPPLE_TRUST_SET),
    },
  })

const buildIssuedPaymentPayload = ({
  destinationTag,
  memo,
}: {
  destinationTag?: number
  memo?: string
} = {}) => {
  const payload = buildTrustSetPayload('1500000000000000')
  payload.toAddress = 'rDestinationAddressForTests9876543210'
  payload.memo = memo
  payload.blockchainSpecific = {
    case: 'rippleSpecific',
    value: makeRippleSpecific(destinationTag),
  }

  return payload
}

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

  // sdk#1200: fee is an int64 proto field; an out-of-range gas must throw
  // rather than silently two's-complement-wrap via Long.fromString.
  it('throws instead of silently wrapping an out-of-int64-range fee', async () => {
    const payload = buildTrustSetPayload('1000000000000000')
    const rippleSpecific = create(RippleSpecificSchema, {
      sequence: 100n,
      gas: 1n << 63n,
      lastLedgerSequence: 200n,
    })
    payload.blockchainSpecific = {
      case: 'rippleSpecific',
      value: rippleSpecific,
    }

    await expect(async () => {
      await getRippleSigningInputs({ keysignPayload: payload, walletCore })
    }).rejects.toThrow(/out of int64 range/)
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

describe('getRippleSigningInputs -- issued-currency Payment build path', () => {
  it('builds an exact CurrencyAmount Payment without partial-payment flags', async () => {
    const [input] = await getRippleSigningInputs({
      keysignPayload: buildIssuedPaymentPayload(),
      walletCore,
    })

    expect(input.opTrustSet).toBeFalsy()
    expect(input.opPayment?.amount).toBeFalsy()
    expect(input.opPayment?.currencyAmount).toMatchObject({
      currency: '524C555344000000000000000000000000000000',
      issuer: RLUSD_ISSUER,
      value: '1.5',
    })
    expect(input.flags.toString()).toBe('0')
  })

  it('preserves DestinationTag on a typed issued-currency Payment', async () => {
    const [input] = await getRippleSigningInputs({
      keysignPayload: buildIssuedPaymentPayload({ destinationTag: 12345 }),
      walletCore,
    })

    expect(input.opPayment?.currencyAmount?.value).toBe('1.5')
    expect(input.opPayment?.destinationTag.toString()).toBe('12345')
  })

  it('preserves an independent memo and exact issued amount in raw JSON', async () => {
    const [input] = await getRippleSigningInputs({
      keysignPayload: buildIssuedPaymentPayload({
        destinationTag: 12345,
        memo: 'invoice 67890',
      }),
      walletCore,
    })

    expect(input.opPayment).toBeFalsy()
    expect(JSON.parse(input.rawJson!)).toMatchObject({
      TransactionType: 'Payment',
      Destination: 'rDestinationAddressForTests9876543210',
      DestinationTag: 12345,
      Amount: {
        currency: '524C555344000000000000000000000000000000',
        issuer: RLUSD_ISSUER,
        value: '1.5',
      },
      Memos: [{ Memo: { MemoData: '696E766F696365203637383930' } }],
    })
    expect(JSON.parse(input.rawJson!).Flags).toBeUndefined()
  })

  it('rejects a non-native coin without an issued-currency token id', () => {
    const payload = buildIssuedPaymentPayload()
    payload.coin!.contractAddress = ''

    expect(() => getRippleSigningInputs({ keysignPayload: payload, walletCore })).toThrow(/requires a coin carrying/)
  })

  it.each(['0', '-1', '12345678901234567'])('rejects an invalid or rounded Payment quantity %s', toAmount => {
    const payload = buildIssuedPaymentPayload()
    payload.toAmount = toAmount
    expect(() => getRippleSigningInputs({ keysignPayload: payload, walletCore })).toThrow(/amount|representable/)
  })

  it('rejects an unrelated transaction discriminator instead of guessing', () => {
    const payload = buildIssuedPaymentPayload()
    payload.blockchainSpecific = {
      case: 'rippleSpecific',
      value: makeRippleSpecific(undefined, TransactionType.VOTE),
    }

    expect(() => getRippleSigningInputs({ keysignPayload: payload, walletCore })).toThrow(
      /Unsupported XRP transaction type/
    )
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

  it('does not require issued-currency coin metadata for a verbatim dApp transaction', async () => {
    const payload = buildSignRipplePayload()
    payload.coin!.isNativeToken = false
    payload.coin!.contractAddress = ''

    const [input] = await getRippleSigningInputs({
      keysignPayload: payload,
      walletCore,
    })

    expect(input.rawJson).toBe(offerCreateJson)
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

  it('rejects a tfPartialPayment Payment that sets no DeliverMin floor', () => {
    // Destination and Amount both match the reviewed metadata, so every other
    // gate passes — but tfPartialPayment makes Amount a ceiling, so the ledger
    // may deliver dust while the sender still pays. The reviewed toAmount no
    // longer describes the outcome, which is exactly what this resolver exists
    // to prevent.
    const payload = buildPaymentPayload()
    payload.signData = {
      case: 'signRipple',
      value: {
        $typeName: 'vultisig.keysign.v1.SignRipple',
        rawJson: JSON.stringify({
          TransactionType: 'Payment',
          Account: ACCOUNT,
          Destination: payload.toAddress,
          Amount: payload.toAmount,
          SendMax: '999999999',
          Flags: 131072,
        }),
      },
    }

    expect(() => getRippleSigningInputs({ keysignPayload: payload, walletCore })).toThrow(/tfPartialPayment/)
  })

  it('forwards a tfPartialPayment Payment whose DeliverMin exactly matches the reviewed Amount', async () => {
    const payload = buildPaymentPayload()
    const paymentJson = JSON.stringify({
      TransactionType: 'Payment',
      Account: ACCOUNT,
      Destination: payload.toAddress,
      Amount: payload.toAmount,
      SendMax: '999999999',
      DeliverMin: payload.toAmount,
      Flags: 131072,
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
  })

  it('rejects a tfPartialPayment Payment whose DeliverMin exceeds the reviewed Amount', () => {
    // On XRPL partial payments, Amount is the delivery ceiling. A larger
    // DeliverMin is unsatisfiable, not a stricter valid guarantee.
    const payload = buildPaymentPayload()
    payload.signData = {
      case: 'signRipple',
      value: {
        $typeName: 'vultisig.keysign.v1.SignRipple',
        rawJson: JSON.stringify({
          TransactionType: 'Payment',
          Account: ACCOUNT,
          Destination: payload.toAddress,
          Amount: payload.toAmount,
          SendMax: '999999999',
          DeliverMin: '1000001',
          Flags: 131072,
        }),
      },
    }

    expect(() => getRippleSigningInputs({ keysignPayload: payload, walletCore })).toThrow(/tfPartialPayment/)
  })

  it('rejects a tfPartialPayment Payment whose DeliverMin floors less than the reviewed Amount', () => {
    // Destination and Amount both match the reviewed metadata and DeliverMin
    // is a well-formed, positive amount — but it floors delivery at a dust
    // fraction of what was reviewed. A DeliverMin merely being present and
    // positive is not a floor the reviewer approved.
    const payload = buildPaymentPayload()
    payload.signData = {
      case: 'signRipple',
      value: {
        $typeName: 'vultisig.keysign.v1.SignRipple',
        rawJson: JSON.stringify({
          TransactionType: 'Payment',
          Account: ACCOUNT,
          Destination: payload.toAddress,
          Amount: payload.toAmount,
          SendMax: '999999999',
          DeliverMin: '1',
          Flags: 131072,
        }),
      },
    }

    expect(() => getRippleSigningInputs({ keysignPayload: payload, walletCore })).toThrow(/DeliverMin/)
  })

  it.each([
    ['null', null],
    ['an empty object', {}],
    ['an issued-currency object missing its value', { currency: 'RLUSD', issuer: RLUSD_ISSUER }],
    ['a non-numeric drops string', 'not-a-number'],
    ['zero drops', '0'],
    ['a zero issued-currency value', { currency: 'RLUSD', issuer: RLUSD_ISSUER, value: '0' }],
    ['just below the reviewed Amount', '999999'],
    ['an unencodable overlong currency code', { currency: 'a'.repeat(30), issuer: RLUSD_ISSUER, value: '999999999' }],
    // Amount here is native XRP; a well-formed positive IOU cannot restore a
    // floor on a different asset than what was actually reviewed.
    [
      'an issued-currency amount when Amount is native XRP',
      { currency: 'RLUSD', issuer: RLUSD_ISSUER, value: '999999999' },
    ],
  ])('rejects a tfPartialPayment Payment whose DeliverMin is %s', (_label, DeliverMin) => {
    const payload = buildPaymentPayload()
    payload.signData = {
      case: 'signRipple',
      value: {
        $typeName: 'vultisig.keysign.v1.SignRipple',
        rawJson: JSON.stringify({
          TransactionType: 'Payment',
          Account: ACCOUNT,
          Destination: payload.toAddress,
          Amount: payload.toAmount,
          SendMax: '999999999',
          DeliverMin,
          Flags: 131072,
        }),
      },
    }

    expect(() => getRippleSigningInputs({ keysignPayload: payload, walletCore })).toThrow(/DeliverMin/)
  })

  it('forwards a tfPartialPayment issued-currency Payment whose DeliverMin meets the reviewed value', async () => {
    const payload = buildTrustSetPayload('1500000000000000')
    payload.toAddress = 'rDestinationAddressForTests9876543210'
    const paymentJson = JSON.stringify({
      TransactionType: 'Payment',
      Account: ACCOUNT,
      Destination: payload.toAddress,
      Amount: { currency: 'RLUSD', issuer: RLUSD_ISSUER, value: '1.5' },
      SendMax: { currency: 'RLUSD', issuer: RLUSD_ISSUER, value: '2' },
      DeliverMin: { currency: 'RLUSD', issuer: RLUSD_ISSUER, value: '1.5' },
      Flags: 131072,
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
  })

  it('rejects a tfPartialPayment issued-currency Payment whose DeliverMin is a different issuer', () => {
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
          Amount: { currency: 'RLUSD', issuer: RLUSD_ISSUER, value: '1.5' },
          SendMax: { currency: 'RLUSD', issuer: RLUSD_ISSUER, value: '2' },
          DeliverMin: {
            currency: 'RLUSD',
            issuer: 'rSomeOtherIssuer00000000000000000',
            value: '1.5',
          },
          Flags: 131072,
        }),
      },
    }

    expect(() => getRippleSigningInputs({ keysignPayload: payload, walletCore })).toThrow(/DeliverMin/)
  })

  it('forwards a Payment whose flags do not touch delivery', async () => {
    // tfFullyCanonicalSig sits above INT32_MAX, so the uint32 bound must not
    // clip it into a rejection.
    const payload = buildPaymentPayload()
    const paymentJson = JSON.stringify({
      TransactionType: 'Payment',
      Account: ACCOUNT,
      Destination: payload.toAddress,
      Amount: payload.toAmount,
      Flags: 2147483648,
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
  })

  it('rejects a Payment whose Flags cannot be read as a uint32', () => {
    // Some client libraries accept `{ tfPartialPayment: true }` sugar. Signing
    // it would mean signing flags this resolver never evaluated.
    const payload = buildPaymentPayload()
    payload.signData = {
      case: 'signRipple',
      value: {
        $typeName: 'vultisig.keysign.v1.SignRipple',
        rawJson: JSON.stringify({
          TransactionType: 'Payment',
          Account: ACCOUNT,
          Destination: payload.toAddress,
          Amount: payload.toAmount,
          Flags: { tfPartialPayment: true },
        }),
      },
    }

    expect(() => getRippleSigningInputs({ keysignPayload: payload, walletCore })).toThrow(/Flags is not a uint32/)
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
    const txInputDataList = await getEncodedSigningInputs({
      keysignPayload: buildInteropPayload(),
      walletCore: interopWalletCore,
    })
    expect(txInputDataList).toHaveLength(1)
    const [txInputData] = txInputDataList

    const preSigningHashes = getPreSigningHashes({
      walletCore: interopWalletCore,
      chain: Chain.Ripple,
      txInputData,
    })
    expect(preSigningHashes).toHaveLength(1)
    const [preSigningHash] = preSigningHashes

    expect(hex(txInputData)).toBe(vector.expected.serializedSigningInputHex)
    expect(hex(preSigningHash)).toBe(vector.expected.preSigningHashHex)
  })

  it.each([undefined, 'invoice 67890'])('signs and decodes an exact issued Payment (memo: %s)', async memo => {
    const privateKey = interopWalletCore.PrivateKey.createWithData(new Uint8Array(32).fill(1))
    const publicKey = privateKey.getPublicKeySecp256k1(true)
    try {
      const payload = buildIssuedPaymentPayload({
        destinationTag: 12345,
        memo,
      })
      payload.coin!.address = interopWalletCore.AnyAddress.createWithPublicKey(
        publicKey,
        interopWalletCore.CoinType.xrp
      ).description()
      payload.coin!.hexPublicKey = hex(publicKey.data())
      payload.toAddress = vector.input.toAddress
      payload.toAmount = '1234567890123456'
      const [input] = await getRippleSigningInputs({
        keysignPayload: payload,
        walletCore: interopWalletCore,
      })
      const output = TW.Ripple.Proto.SigningOutput.decode(
        interopWalletCore.AnySigner.sign(
          TW.Ripple.Proto.SigningInput.encode({
            ...input,
            privateKey: privateKey.data(),
          }).finish(),
          interopWalletCore.CoinType.xrp
        )
      )
      expect(output.error).toBe(0)
      const decoded = decode(hex(output.encoded))
      expect(decoded).toMatchObject({
        TransactionType: 'Payment',
        Account: payload.coin!.address,
        Destination: payload.toAddress,
        Amount: {
          currency: '524C555344000000000000000000000000000000',
          issuer: RLUSD_ISSUER,
          value: '1.234567890123456',
        },
        DestinationTag: 12345,
        Fee: '15',
        Sequence: 100,
        LastLedgerSequence: 200,
      })
      expect(Number(decoded.Flags ?? 0) & 0x00020000).toBe(0)
      const [hash] = getPreSigningHashes({
        walletCore: interopWalletCore,
        chain: Chain.Ripple,
        txInputData: TW.Ripple.Proto.SigningInput.encode(input).finish(),
      })
      expect(hex(hash)).toBe(
        createHash('sha512')
          .update(Buffer.from(encodeForSigning(decoded), 'hex'))
          .digest('hex')
          .slice(0, 64)
      )
    } finally {
      publicKey.delete()
      privateKey.delete()
    }
  })
})

describe('getRippleSigningInputs -- TrustSet discriminator (RippleSpecific.transaction_type)', () => {
  const buildDiscriminatedTrustSetPayload = (toAmount: string) => {
    const payload = buildTrustSetPayload(toAmount)
    const rippleSpecific = create(RippleSpecificSchema, {
      sequence: 100n,
      gas: 15n,
      lastLedgerSequence: 200n,
      transactionType: TransactionType.RIPPLE_TRUST_SET,
    })
    payload.blockchainSpecific = {
      case: 'rippleSpecific',
      value: rippleSpecific,
    }

    return payload
  }

  it('builds a TrustSet when the payload states it explicitly', async () => {
    const [input] = await getRippleSigningInputs({
      keysignPayload: buildDiscriminatedTrustSetPayload('1500000000000000'),
      walletCore,
    })

    expect(input.opTrustSet).toBeTruthy()
    expect(input.opPayment).toBeFalsy()
  })

  it('keeps legacy undiscriminated TrustSet payloads compatible', async () => {
    const payload = buildTrustSetPayload('1500000000000000')
    payload.blockchainSpecific = {
      case: 'rippleSpecific',
      value: makeRippleSpecific(undefined, TransactionType.UNSPECIFIED),
    }

    const [input] = await getRippleSigningInputs({ keysignPayload: payload, walletCore })

    expect(input.opTrustSet).toBeTruthy()
    expect(input.opPayment).toBeFalsy()
  })

  it('keeps an explicit issued-currency Payment to the issuer on the Payment path', async () => {
    const payload = buildTrustSetPayload('1500000000000000')
    payload.blockchainSpecific = {
      case: 'rippleSpecific',
      value: makeRippleSpecific(undefined, TransactionType.RIPPLE_PAYMENT),
    }

    const [input] = await getRippleSigningInputs({ keysignPayload: payload, walletCore })

    expect(input.opTrustSet).toBeFalsy()
    expect(input.opPayment?.currencyAmount).toMatchObject({
      currency: toXrplCurrencyCode('RLUSD'),
      issuer: RLUSD_ISSUER,
      value: '1.5',
    })
  })

  it('rejects an explicit TrustSet whose reviewed destination is not the issuer', () => {
    const payload = buildDiscriminatedTrustSetPayload('1500000000000000')
    payload.toAddress = 'rDestinationAddressForTests9876543210'

    expect(() => getRippleSigningInputs({ keysignPayload: payload, walletCore })).toThrow(
      /destination does not match.*issuer/
    )
  })

  it('treats an unspecified non-native payload as a Payment, not a TrustSet', async () => {
    const amount = '1500000000000000'
    const payload = buildTrustSetPayload(amount)
    payload.toAddress = 'rDestinationAddressForTests9876543210'
    payload.blockchainSpecific = {
      case: 'rippleSpecific',
      value: makeRippleSpecific(),
    }

    const [input] = await getRippleSigningInputs({
      keysignPayload: payload,
      walletCore,
    })

    expect(input.opPayment?.currencyAmount?.value).toBe('1.5')
    expect(input.opTrustSet).toBeFalsy()
  })

  it('fails closed across a token-payment committee containing a legacy shape-inference signer', async () => {
    const modernPayload = buildIssuedPaymentPayload()
    const [modernInput] = await getRippleSigningInputs({
      keysignPayload: modernPayload,
      walletCore,
    })
    const legacyInferredInput = TW.Ripple.Proto.SigningInput.create({
      account: modernInput.account,
      fee: modernInput.fee,
      sequence: modernInput.sequence,
      lastLedgerSequence: modernInput.lastLedgerSequence,
      publicKey: modernInput.publicKey,
      // This is the operation an older resolver infers from the exact same
      // non-native coin shape, regardless of the Payment destination.
      opTrustSet: TW.Ripple.Proto.OperationTrustSet.create({
        limitAmount: TW.Ripple.Proto.CurrencyAmount.create({
          currency: '524C555344000000000000000000000000000000',
          issuer: RLUSD_ISSUER,
          value: '1.5',
        }),
      }),
    })

    const modernBytes = TW.Ripple.Proto.SigningInput.encode(modernInput).finish()
    const legacyBytes = TW.Ripple.Proto.SigningInput.encode(legacyInferredInput).finish()

    expect(Buffer.from(modernBytes).toString('hex')).not.toBe(Buffer.from(legacyBytes).toString('hex'))
  })

  it('leaves native XRP a Payment even though the field is unset', async () => {
    const [input] = await getRippleSigningInputs({
      keysignPayload: buildPaymentPayload(),
      walletCore,
    })

    expect(input.opPayment).toBeTruthy()
    expect(input.opTrustSet).toBeFalsy()
  })
})
