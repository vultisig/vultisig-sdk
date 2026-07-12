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

const makeRippleSpecific = () =>
  create(RippleSpecificSchema, {
    sequence: 100n,
    gas: 15n,
    lastLedgerSequence: 200n,
  })

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

const buildPaymentPayload = () =>
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
    blockchainSpecific: { case: 'rippleSpecific', value: makeRippleSpecific() },
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
})

describe('getRippleSigningInputs -- amount strict parse (#1147)', () => {
  it("rejects an unset ('') issued-currency amount instead of a zero trust-line limit", () => {
    // Pre-fix: BigInt('') -> 0n -> formatIssuedCurrencyValue(0n) -> a '0' limit
    // silently co-signed.
    expect(() =>
      getRippleSigningInputs({
        keysignPayload: buildTrustSetPayload(''),
        walletCore,
      })
    ).toThrow(RangeError)
  })

  it('rejects a negative issued-currency amount', () => {
    expect(() =>
      getRippleSigningInputs({
        keysignPayload: buildTrustSetPayload('-1'),
        walletCore,
      })
    ).toThrow(RangeError)
  })

  it('still builds an issued-currency limit above 64 bits (XRPL IOU values are not 64-bit)', async () => {
    const [input] = await getRippleSigningInputs({
      keysignPayload: buildTrustSetPayload((2n ** 64n).toString()),
      walletCore,
    })
    // 2^64 raw units at 15 decimals.
    expect(input.opTrustSet?.limitAmount?.value).toBe('18446.744073709551616')
  })

  it("rejects an unset ('') amount on the raw-JSON memo payment path", () => {
    const payload = buildPaymentPayload()
    payload.memo = 'not-a-destination-tag'
    payload.toAmount = ''
    expect(() =>
      getRippleSigningInputs({
        keysignPayload: payload,
        walletCore,
      })
    ).toThrow(RangeError)
  })

  it('rejects a negative amount on the raw-JSON memo payment path', () => {
    // XRP drops are non-negative; unsigned bound throws pre-ceremony instead
    // of building JSON that XRPL would reject post-sign.
    const payload = buildPaymentPayload()
    payload.memo = 'not-a-destination-tag'
    payload.toAmount = '-1'
    expect(() =>
      getRippleSigningInputs({
        keysignPayload: payload,
        walletCore,
      })
    ).toThrow(RangeError)
  })

  it('keeps the raw-JSON memo payment amount unchanged for a valid value', async () => {
    const payload = buildPaymentPayload()
    payload.memo = 'not-a-destination-tag'
    const [input] = await getRippleSigningInputs({
      keysignPayload: payload,
      walletCore,
    })
    expect(JSON.parse(input.rawJson ?? '{}').Amount).toBe('1000000')
  })
})
