import { create } from '@bufbuild/protobuf'
import { type WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import {
  rippleIssuedCurrencyDecimals,
  rippleTokenId,
  toXrplCurrencyCode,
} from '@vultisig/core-chain/chains/ripple/issuedCurrency'
import { RippleSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { describe, expect, it } from 'vitest'

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

const buildPaymentPayload = ({ destinationTag, memo }: { destinationTag?: number; memo?: string } = {}) =>
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
    blockchainSpecific: { case: 'rippleSpecific', value: makeRippleSpecific(destinationTag) },
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
      keysignPayload: buildPaymentPayload({ destinationTag: 12345, memo: '67890' }),
      walletCore,
    })

    expect(input.opPayment).toBeFalsy()
    expect(JSON.parse(input.rawJson!)).toMatchObject({
      DestinationTag: 12345,
      Memos: [{ Memo: { MemoData: '3637383930' } }],
    })
  })

  it('does not treat an echoed tag memo as a distinct memo', async () => {
    const [input] = await getRippleSigningInputs({
      keysignPayload: buildPaymentPayload({ destinationTag: 12345, memo: '12345' }),
      walletCore,
    })

    expect(input.opPayment?.destinationTag?.toString()).toBe('12345')
    expect(input.rawJson).toBeFalsy()
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

  it.each([0, -1, 4294967296, 1.5])('rejects an invalid first-class destination tag: %s', destinationTag => {
    expect(() =>
      getRippleSigningInputs({
        keysignPayload: buildPaymentPayload({ destinationTag }),
        walletCore,
      })
    ).toThrow('Invalid XRP destination tag')
  })
})
