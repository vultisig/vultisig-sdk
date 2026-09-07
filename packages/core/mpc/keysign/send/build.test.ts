import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { rippleKnownIssuedTokens } from '@vultisig/core-chain/chains/ripple/issuedCurrency'
import {
  RippleSpecificSchema,
  TonSpecificSchema,
  TransactionType,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import type { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getChainSpecificMock, getCoinBalanceMock, getKeysignUtxoInfoMock } = vi.hoisted(() => ({
  getChainSpecificMock: vi.fn(),
  getCoinBalanceMock: vi.fn(),
  getKeysignUtxoInfoMock: vi.fn(),
}))

vi.mock('@vultisig/core-mpc/keysign/chainSpecific', () => ({
  getChainSpecific: getChainSpecificMock,
}))
vi.mock('@vultisig/core-chain/coin/balance', () => ({
  getCoinBalance: getCoinBalanceMock,
}))
vi.mock('@vultisig/core-mpc/keysign/utxo/getKeysignUtxoInfo', () => ({
  getKeysignUtxoInfo: getKeysignUtxoInfoMock,
}))

import { buildSendKeysignPayload } from './build'

const rippleCoin = {
  chain: Chain.Ripple,
  ticker: 'XRP',
  address: 'rSenderAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  decimals: 6,
}

const buildPayload = ({
  memo,
  receiver = 'rDestinationBBBBBBBBBBBBBBBBBBBBBB',
  destinationTag = 12345,
  omitDestinationTag = false,
  sendMaxAmount,
  coin = rippleCoin,
  amount = 1_000_000n,
}: {
  memo?: string
  receiver?: string
  destinationTag?: number
  omitDestinationTag?: boolean
  sendMaxAmount?: boolean
  coin?: Parameters<typeof buildSendKeysignPayload>[0]['coin']
  amount?: bigint
} = {}) =>
  buildSendKeysignPayload({
    coin,
    receiver,
    amount,
    memo,
    destinationTag: omitDestinationTag ? undefined : destinationTag,
    vaultId: 'vault-public-key',
    localPartyId: 'party-1',
    publicKey: null,
    hexPublicKeyOverride: `02${'ab'.repeat(32)}`,
    libType: 'DKLS',
    walletCore: {} as never,
    sendMaxAmount,
  })

const expectRippleDestinationTag = (payload: KeysignPayload, destinationTag: number) => {
  expect(payload.blockchainSpecific.case).toBe('rippleSpecific')
  if (payload.blockchainSpecific.case !== 'rippleSpecific') {
    throw new Error('Expected Ripple-specific keysign data')
  }
  expect(payload.blockchainSpecific.value.destinationTag).toBe(destinationTag)
}

describe('buildSendKeysignPayload XRP DestinationTag compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getCoinBalanceMock.mockResolvedValue(2_000_000n)
    getKeysignUtxoInfoMock.mockResolvedValue(undefined)
    getChainSpecificMock.mockImplementation(async ({ destinationTag }) => ({
      case: 'rippleSpecific',
      value: create(RippleSpecificSchema, {
        sequence: 1n,
        gas: 15n,
        lastLedgerSequence: 2n,
        destinationTag,
      }),
    }))
  })

  it('dual-writes a tag-only send into the serialized legacy memo carrier', async () => {
    const payload = await buildPayload()
    const roundTrip = fromBinary(KeysignPayloadSchema, toBinary(KeysignPayloadSchema, payload))

    expect(roundTrip.memo).toBe('12345')
    expectRippleDestinationTag(roundTrip, 12345)
  })

  it('explicitly requests a Payment instead of inferring TrustSet from the recipient', async () => {
    const payload = await buildPayload({
      coin: { ...rippleKnownIssuedTokens[0], address: rippleCoin.address },
      receiver: 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De',
      amount: 1_500_000_000_000_000n,
    })

    expect(getChainSpecificMock).toHaveBeenCalledWith(
      expect.objectContaining({ transactionType: TransactionType.RIPPLE_PAYMENT })
    )
    expect(payload.coin?.isNativeToken).toBe(false)
    expect(payload.toAmount).toBe('1500000000000000')
  })

  it.each([
    { label: 'inexact', amount: 12_345_678_901_234_567n, message: /16 significant digits/ },
    { label: 'zero', amount: 0n, message: /must be positive/ },
  ])(
    'rejects an $label issued amount as bad input, before preparing a transaction for review',
    async ({ amount, message }) => {
      // A domain error rather than a bare Error so callers stop retrying and
      // surface the reason instead of a generic failure.
      const build = buildPayload({
        coin: { ...rippleKnownIssuedTokens[0], address: rippleCoin.address },
        amount,
      })

      await expect(build).rejects.toMatchObject({ type: 'ripple-issued-currency-amount-invalid' })
      await expect(build).rejects.toThrow(message)
      expect(getChainSpecificMock).not.toHaveBeenCalled()
    }
  )

  it('treats the empty memo supplied by Windows as absent for tag-only dual-write', async () => {
    const payload = await buildPayload({ memo: '' })

    expect(payload.memo).toBe('12345')
    expectRippleDestinationTag(payload, 12345)
  })

  it('dual-writes a first-class zero tag without losing presence', async () => {
    const payload = await buildPayload({ destinationTag: 0 })
    const roundTrip = fromBinary(KeysignPayloadSchema, toBinary(KeysignPayloadSchema, payload))

    expect(roundTrip.memo).toBe('0')
    expectRippleDestinationTag(roundTrip, 0)
  })

  it('preserves a caller-supplied memo as independent XRPL memo data', async () => {
    const payload = await buildPayload({ memo: 'invoice 12345' })

    expect(payload.memo).toBe('invoice 12345')
    expectRippleDestinationTag(payload, 12345)
  })

  it('preserves a distinct numeric memo alongside the first-class tag', async () => {
    const payload = await buildPayload({ memo: '67890' })

    expect(payload.memo).toBe('67890')
    expectRippleDestinationTag(payload, 12345)
  })

  it('normalizes an X-address and applies its embedded tag', async () => {
    const payload = await buildPayload({
      receiver: 'XV5sbjUmgPpvXv4ixFWZ5ptAYZ6PD2q1qM6owqNbug8W6KV',
      omitDestinationTag: true,
    })

    expect(payload.toAddress).toBe('rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY')
    expect(payload.memo).toBe('495')
    expectRippleDestinationTag(payload, 495)
  })

  it('rejects a manual tag that conflicts with the X-address tag', async () => {
    await expect(
      buildPayload({
        receiver: 'XV5sbjUmgPpvXv4ixFWZ5ptAYZ6PD2q1qM6owqNbug8W6KV',
        destinationTag: 12345,
      })
    ).rejects.toMatchObject({ type: 'ripple-destination-tag-invalid' })
  })
})

describe('buildSendKeysignPayload MAX intent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getCoinBalanceMock.mockResolvedValue(2_000_000n)
    getKeysignUtxoInfoMock.mockResolvedValue(undefined)
    getChainSpecificMock.mockResolvedValue({
      case: 'rippleSpecific',
      value: create(RippleSpecificSchema, {
        sequence: 1n,
        gas: 15n,
        lastLedgerSequence: 2n,
      }),
    })
  })

  // The chain-specific resolver records MAX rather than deriving it, so it only ever
  // knows what this builder forwards.
  it('forwards the caller MAX flag to the chain-specific resolver', async () => {
    await buildPayload({ sendMaxAmount: true })

    expect(getChainSpecificMock).toHaveBeenCalledWith(expect.objectContaining({ sendMaxAmount: true }))
  })

  it('leaves the flag unset when the caller did not pass one', async () => {
    await buildPayload()

    expect(getChainSpecificMock).toHaveBeenCalledWith(expect.objectContaining({ sendMaxAmount: undefined }))
  })
})

// A TON memo that does not fit its cell used to be caught only in the
// signing-input resolver — after the user had reviewed and approved the
// transaction, and for a jetton only as a bare WalletCore "Internal error".
// The payload build is the last point that still has both the final amount and
// `isActiveDestination`, so it is where the check belongs.
describe('buildSendKeysignPayload TON memo capacity', () => {
  const tonAddress = 'UQCc9iCgP_b5RMJcFE5XD8zStfjtNHLhDWfUqC5m1SjSer95'

  const buildTonPayload = ({
    memo,
    amount = 5_000_000n,
    id,
    isActiveDestination = true,
  }: {
    memo: string
    amount?: bigint
    id?: string
    isActiveDestination?: boolean
  }) => {
    getChainSpecificMock.mockResolvedValue({
      case: 'tonSpecific',
      value: create(TonSpecificSchema, {
        sequenceNumber: 1n,
        expireAt: 1_800_000_000n,
        bounceable: true,
        jettonAddress: id ? 'EQCIcjES4cQET0z6nRixZ0MdvTB4u3_8triztLSrIIrDkpgJ' : '',
        isActiveDestination,
      }),
    })

    return buildSendKeysignPayload({
      coin: {
        chain: Chain.Ton,
        ticker: id ? 'USDT' : 'TON',
        address: tonAddress,
        decimals: id ? 6 : 9,
        id,
      },
      receiver: tonAddress,
      amount,
      memo,
      vaultId: 'vault-public-key',
      localPartyId: 'party-1',
      publicKey: null,
      hexPublicKeyOverride: `02${'ab'.repeat(32)}`,
      libType: 'DKLS',
      walletCore: {} as never,
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    getCoinBalanceMock.mockResolvedValue(10_000_000_000n)
    getKeysignUtxoInfoMock.mockResolvedValue(undefined)
  })

  it('keeps a native memo that fits the cell', async () => {
    const payload = await buildTonPayload({ memo: 'x'.repeat(123) })

    expect(payload.memo).toBe('x'.repeat(123))
  })

  it('rejects a native memo one byte over', async () => {
    await expect(buildTonPayload({ memo: 'x'.repeat(124) })).rejects.toThrow(/at most 123 bytes/)
  })

  it('keeps a jetton memo that fits the inline forward payload', async () => {
    const payload = await buildTonPayload({
      memo: 'x'.repeat(39),
      id: 'EQjettonMaster',
    })

    expect(payload.memo).toBe('x'.repeat(39))
  })

  it('rejects a jetton memo the native cap would have allowed, before the user ever signs', async () => {
    await expect(buildTonPayload({ memo: 'x'.repeat(40), id: 'EQjettonMaster' })).rejects.toThrow(
      /at most 39 bytes for this jetton amount/
    )
  })

  it('reads the cap from the resolved amount and destination state, not from a constant', async () => {
    await expect(
      buildTonPayload({
        memo: 'x'.repeat(39),
        amount: 10n ** 18n,
        id: 'EQjettonMaster',
      })
    ).rejects.toThrow(/at most 34 bytes/)

    const payload = await buildTonPayload({
      memo: 'x'.repeat(40),
      id: 'EQjettonMaster',
      isActiveDestination: false,
    })
    expect(payload.memo).toBe('x'.repeat(40))
  })

  // The send form retries transient build failures; bad input must not be one.
  it('raises a non-retryable BuildKeysignPayloadError', async () => {
    await expect(buildTonPayload({ memo: 'x'.repeat(124) })).rejects.toMatchObject({
      name: 'BuildKeysignPayloadError',
      type: 'ton-memo-too-long',
    })
  })
})
