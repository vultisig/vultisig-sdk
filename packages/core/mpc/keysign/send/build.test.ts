import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { RippleSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
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
}: {
  memo?: string
  receiver?: string
  destinationTag?: number
  omitDestinationTag?: boolean
} = {}) =>
  buildSendKeysignPayload({
    coin: rippleCoin,
    receiver,
    amount: 1_000_000n,
    memo,
    destinationTag: omitDestinationTag ? undefined : destinationTag,
    vaultId: 'vault-public-key',
    localPartyId: 'party-1',
    publicKey: null,
    hexPublicKeyOverride: `02${'ab'.repeat(32)}`,
    libType: 'DKLS',
    walletCore: {} as never,
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
