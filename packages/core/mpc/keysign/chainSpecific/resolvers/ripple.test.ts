import { create } from '@bufbuild/protobuf'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Chain } from '@vultisig/core-chain/Chain'

import { BuildKeysignPayloadError } from '../../error'
import { CoinSchema } from '../../../types/vultisig/keysign/v1/coin_pb'
import { TransactionType } from '../../../types/vultisig/keysign/v1/blockchain_specific_pb'
import { KeysignPayloadSchema } from '../../../types/vultisig/keysign/v1/keysign_message_pb'

const SENDER = 'rSenderAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const DEST_FUNDED = 'rFundedBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
const DEST_UNFUNDED = 'rFreshCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'

// base_fee 10, load_factor==load_base ⇒ computedFee = 10*2 = 20 ⇒ networkFee 20.
const RESERVE_BASE = 1_000_000
const EXPECTED_NETWORK_FEE = 20n
const REQUIRE_DESTINATION_TAG = 0x00020000

const accountInfo = (flags = 0, ledgerCurrentIndex: number | undefined = 100) => ({
  account_data: {
    Account: SENDER,
    Balance: '1000000',
    Flags: flags,
    index: '0'.repeat(64),
    LedgerEntryType: 'AccountRoot' as const,
    OwnerCount: 0,
    PreviousTxnID: '0'.repeat(64),
    PreviousTxnLgrSeq: 0,
    Sequence: 5,
  },
  ledger_current_index: ledgerCurrentIndex,
})

const accountInfoWithoutLedgerCurrentIndex = () => {
  const { ledger_current_index: _ledgerCurrentIndex, ...result } = accountInfo()

  return result
}

vi.mock('@vultisig/core-chain/chains/ripple/network/info', () => ({
  getRippleNetworkInfo: vi.fn(async () => ({
    validated_ledger: { base_fee: 10, reserve_base: RESERVE_BASE },
    load_factor: 256,
    load_base: 256,
  })),
}))

vi.mock('@vultisig/core-chain/chains/ripple/account/info', () => ({
  getRippleAccountInfo: vi.fn(async (address: string) => {
    if (address === DEST_UNFUNDED) {
      throw new Error('Account not found.')
    }
    return accountInfo()
  }),
}))

import { getRippleChainSpecific } from './ripple'

const payload = (toAddress: string, toAmount: string) =>
  create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: Chain.Ripple,
      ticker: 'XRP',
      address: SENDER,
      contractAddress: '',
      decimals: 6,
      isNativeToken: true,
    }),
    toAddress,
    toAmount,
  })

describe('getRippleChainSpecific — reserve belongs on Amount, not the burned Fee', () => {
  it('funded destination: gas is the network fee only (no reserve added)', async () => {
    const res = await getRippleChainSpecific({
      keysignPayload: payload(DEST_FUNDED, '1000'),
      walletCore: {} as never,
    })
    expect(res.gas).toBe(EXPECTED_NETWORK_FEE)
    expect(res.lastLedgerSequence).toBe(160n)
  })

  it('rejects account_info responses without ledger_current_index', async () => {
    const { getRippleAccountInfo } = await import('@vultisig/core-chain/chains/ripple/account/info')
    vi.mocked(getRippleAccountInfo).mockResolvedValueOnce(accountInfoWithoutLedgerCurrentIndex())

    await expect(
      getRippleChainSpecific({
        keysignPayload: payload(DEST_FUNDED, '1000'),
        walletCore: {} as never,
      })
    ).rejects.toThrow(/ledger_current_index/i)
  })

  it('unfunded destination with amount >= reserve: gas is STILL the network fee only', async () => {
    // The old bug inflated gas to networkFee + reserve_base (~1 XRP burned).
    const res = await getRippleChainSpecific({
      keysignPayload: payload(DEST_UNFUNDED, String(RESERVE_BASE)),
      walletCore: {} as never,
    })
    expect(res.gas).toBe(EXPECTED_NETWORK_FEE)
    expect(res.gas).toBeLessThan(BigInt(RESERVE_BASE))
  })

  it('unfunded destination with amount < reserve: rejects instead of building a doomed/wasteful tx', async () => {
    await expect(
      getRippleChainSpecific({
        keysignPayload: payload(DEST_UNFUNDED, '500000'),
        walletCore: {} as never,
      })
    ).rejects.toThrow(/not yet activated|base reserve/i)
  })

  it('carries a first-class destination tag and preserves the uint32 maximum', async () => {
    const res = await getRippleChainSpecific({
      keysignPayload: payload(DEST_FUNDED, '1000000'),
      walletCore: {} as never,
      destinationTag: 4_294_967_295,
    })

    expect(res.destinationTag).toBe(4_294_967_295)
  })

  it('rejects a missing tag for an account that requires DestinationTag', async () => {
    const { getRippleAccountInfo } = await import('@vultisig/core-chain/chains/ripple/account/info')
    vi.mocked(getRippleAccountInfo).mockImplementation(async address =>
      accountInfo(address === DEST_FUNDED ? REQUIRE_DESTINATION_TAG : 0)
    )

    await expect(
      getRippleChainSpecific({
        keysignPayload: payload(DEST_FUNDED, '1000000'),
        walletCore: {} as never,
      })
    ).rejects.toMatchObject({ type: 'ripple-destination-tag-required' })
  })

  it('accepts a legacy zero memo as a valid DestinationTag', async () => {
    const { getRippleAccountInfo } = await import('@vultisig/core-chain/chains/ripple/account/info')
    vi.mocked(getRippleAccountInfo).mockImplementation(async address =>
      accountInfo(address === DEST_FUNDED ? REQUIRE_DESTINATION_TAG : 0)
    )
    const keysignPayload = payload(DEST_FUNDED, '1000000')
    keysignPayload.memo = '0'

    const result = await getRippleChainSpecific({
      keysignPayload,
      walletCore: {} as never,
    })
    expect(result.destinationTag).toBe(0)
  })

  it('accepts a legacy canonical numeric memo for an account that requires DestinationTag', async () => {
    const { getRippleAccountInfo } = await import('@vultisig/core-chain/chains/ripple/account/info')
    vi.mocked(getRippleAccountInfo).mockImplementation(async address =>
      accountInfo(address === DEST_FUNDED ? REQUIRE_DESTINATION_TAG : 0)
    )
    const keysignPayload = payload(DEST_FUNDED, '1000000')
    keysignPayload.memo = '12345'

    await expect(getRippleChainSpecific({ keysignPayload, walletCore: {} as never })).resolves.toBeTruthy()
  })

  it('fails closed when an existing destination cannot be inspected for DestinationTag requirement', async () => {
    const { getRippleAccountInfo } = await import('@vultisig/core-chain/chains/ripple/account/info')
    vi.mocked(getRippleAccountInfo).mockImplementation(async address => {
      if (address === DEST_FUNDED) throw new Error('XRPL unavailable')
      return accountInfo()
    })

    const error = await getRippleChainSpecific({
      keysignPayload: payload(DEST_FUNDED, '1000000'),
      walletCore: {} as never,
    }).catch(value => value)

    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(BuildKeysignPayloadError)
    expect(error.message).toMatch(/unable to verify.*requires a DestinationTag/i)
  })
})

describe('getRippleChainSpecific — states the XRPL operation on the wire', () => {
  const ISSUER = 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De'

  // Earlier tests replace the account-info mock outright, so restore the
  // default rather than inherit whichever one ran last.
  beforeEach(async () => {
    const { getRippleAccountInfo } = await import('@vultisig/core-chain/chains/ripple/account/info')
    vi.mocked(getRippleAccountInfo).mockImplementation(async (address: string) => {
      if (address === DEST_UNFUNDED) {
        throw new Error('Account not found.')
      }

      return accountInfo()
    })
  })

  const issuedCurrencyPayload = () =>
    create(KeysignPayloadSchema, {
      coin: create(CoinSchema, {
        chain: Chain.Ripple,
        ticker: 'RLUSD',
        address: SENDER,
        contractAddress: `524C555344000000000000000000000000000000.${ISSUER}`,
        decimals: 15,
        isNativeToken: false,
      }),
      toAddress: ISSUER,
      toAmount: '1000000000000000',
    })

  it('marks an issued-currency payload as a TrustSet', async () => {
    // Without this a co-signer has only the coin to go on, and one that reads
    // the undiscriminated case as a token Payment signs different bytes.
    const res = await getRippleChainSpecific({
      keysignPayload: issuedCurrencyPayload(),
      walletCore: {} as never,
    })

    expect(res.transactionType).toBe(TransactionType.RIPPLE_TRUST_SET)
  })

  it('leaves a native XRP payload undiscriminated, so its bytes are unchanged', async () => {
    const res = await getRippleChainSpecific({
      keysignPayload: payload(DEST_FUNDED, '1000'),
      walletCore: {} as never,
    })

    expect(res.transactionType).toBe(TransactionType.UNSPECIFIED)
  })

  it('does not claim a verbatim dApp transaction is a TrustSet', async () => {
    // `signRipple` is signed exactly as supplied and never rebuilt from the coin.
    // A dApp transaction carries no toAddress — an offer has no destination.
    const dAppPayload = issuedCurrencyPayload()
    dAppPayload.toAddress = ''
    dAppPayload.signData = {
      case: 'signRipple',
      value: {
        rawJson: JSON.stringify({
          TransactionType: 'OfferCreate',
          Account: SENDER,
        }),
      },
    } as never

    const res = await getRippleChainSpecific({
      keysignPayload: dAppPayload,
      walletCore: {} as never,
    })

    expect(res.transactionType).toBe(TransactionType.UNSPECIFIED)
  })
})

describe('getRippleChainSpecific — only genuine trust lines are declared', () => {
  const ISSUER = 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De'
  const RECIPIENT = 'rFriendDDDDDDDDDDDDDDDDDDDDDDDDDDDD'
  const SOLO_TOKEN_ID = `534F4C4F00000000000000000000000000000000.${ISSUER}`

  beforeEach(async () => {
    const { getRippleAccountInfo } = await import('@vultisig/core-chain/chains/ripple/account/info')
    vi.mocked(getRippleAccountInfo).mockImplementation(async (address: string) => {
      if (address === DEST_UNFUNDED) {
        throw new Error('Account not found.')
      }

      return accountInfo()
    })
  })

  const issuedCurrencyPayloadTo = (toAddress: string) =>
    create(KeysignPayloadSchema, {
      coin: create(CoinSchema, {
        chain: Chain.Ripple,
        ticker: 'SOLO',
        address: SENDER,
        contractAddress: SOLO_TOKEN_ID,
        decimals: 15,
        isNativeToken: false,
      }),
      toAddress,
      toAmount: '5000000000000000',
    })

  it('does not declare a send of an issued currency a TrustSet', async () => {
    // The coin shape is identical to a trust line's. Declaring this one would
    // make every signer agree to build a TrustSet from a payment the user
    // intended as a send — a completed ceremony over the wrong operation,
    // where previously the devices simply diverged and signed nothing.
    const res = await getRippleChainSpecific({
      keysignPayload: issuedCurrencyPayloadTo(RECIPIENT),
      walletCore: {} as never,
    })

    expect(res.transactionType).toBe(TransactionType.UNSPECIFIED)
  })

  it('checks DestinationTag requirements for an issued-currency Payment', async () => {
    const { getRippleAccountInfo } = await import('@vultisig/core-chain/chains/ripple/account/info')
    vi.mocked(getRippleAccountInfo).mockImplementation(async address =>
      accountInfo(address === RECIPIENT ? REQUIRE_DESTINATION_TAG : 0)
    )

    await expect(
      getRippleChainSpecific({
        keysignPayload: issuedCurrencyPayloadTo(RECIPIENT),
        walletCore: {} as never,
      })
    ).rejects.toMatchObject({ type: 'ripple-destination-tag-required' })
  })

  it('keeps an explicitly requested token Payment to its issuer a Payment', async () => {
    const result = await getRippleChainSpecific({
      keysignPayload: issuedCurrencyPayloadTo(ISSUER),
      walletCore: {} as never,
      transactionType: TransactionType.RIPPLE_PAYMENT,
    })

    expect(result.transactionType).toBe(TransactionType.RIPPLE_PAYMENT)
  })

  it('checks the issuer destination tag when explicitly sending a redemption Payment', async () => {
    const { getRippleAccountInfo } = await import('@vultisig/core-chain/chains/ripple/account/info')
    vi.mocked(getRippleAccountInfo).mockImplementation(async address =>
      accountInfo(address === ISSUER ? REQUIRE_DESTINATION_TAG : 0)
    )

    await expect(
      getRippleChainSpecific({
        keysignPayload: issuedCurrencyPayloadTo(ISSUER),
        walletCore: {} as never,
        transactionType: TransactionType.RIPPLE_PAYMENT,
      })
    ).rejects.toMatchObject({ type: 'ripple-destination-tag-required' })
  })

  it('rejects an issued-currency Payment to an unactivated destination', async () => {
    await expect(
      getRippleChainSpecific({
        keysignPayload: issuedCurrencyPayloadTo(DEST_UNFUNDED),
        walletCore: {} as never,
      })
    ).rejects.toThrow(/issued currency.*not activated/i)
  })

  it('classifies an idless non-native coin as issued currency for an unactivated destination', async () => {
    const keysignPayload = issuedCurrencyPayloadTo(DEST_UNFUNDED)
    keysignPayload.coin!.contractAddress = ''

    await expect(
      getRippleChainSpecific({
        keysignPayload,
        walletCore: {} as never,
      })
    ).rejects.toThrow(/issued currency.*not activated/i)
  })

  it('declares a trust line, which is addressed to the issuer', async () => {
    const res = await getRippleChainSpecific({
      keysignPayload: issuedCurrencyPayloadTo(ISSUER),
      walletCore: {} as never,
    })

    expect(res.transactionType).toBe(TransactionType.RIPPLE_TRUST_SET)
  })

  it('does not declare one when the token id cannot be parsed', async () => {
    const payload = create(KeysignPayloadSchema, {
      coin: create(CoinSchema, {
        chain: Chain.Ripple,
        ticker: 'SOLO',
        address: SENDER,
        contractAddress: 'not-a-token-id',
        decimals: 15,
        isNativeToken: false,
      }),
      toAddress: ISSUER,
      toAmount: '5000000000000000',
    })

    const res = await getRippleChainSpecific({
      keysignPayload: payload,
      walletCore: {} as never,
    })

    expect(res.transactionType).toBe(TransactionType.UNSPECIFIED)
  })
})
