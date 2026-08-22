import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { Chain, EvmChain } from '@vultisig/core-chain/Chain'
import {
  EthereumSpecificSchema,
  RippleSpecificSchema,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import type { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import type { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'
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

// gh#1390: refineKeysignAmount re-caps a native-max send to the fee the
// signed payload actually carries. That safety net must apply the same way
// whether the caller resolves the signing key via `publicKey` or via
// `hexPublicKeyOverride` (the MLDSA-only / post-quantum path) — the recap
// doesn't care how the key was resolved, only about the resulting amount/fee.
describe('buildSendKeysignPayload native-max fee recap', () => {
  const evmCoin = {
    chain: EvmChain.Ethereum,
    ticker: 'ETH',
    address: '0x1111111111111111111111111111111111111111',
    decimals: 18,
  }

  const balance = 1_000_000_000_000_000_000n
  const gasLimit = '21000'
  const maxFeePerGasWei = '50000000000'
  const fee = BigInt(gasLimit) * BigInt(maxFeePerGasWei)

  const fakePublicKey = { data: () => new Uint8Array(33).fill(2) } as unknown as PublicKey

  const buildMaxSend = (keyInput: { publicKey: PublicKey | null; hexPublicKeyOverride?: string }) =>
    buildSendKeysignPayload({
      coin: evmCoin,
      receiver: '0x2222222222222222222222222222222222222222',
      // "send max": the caller quotes the full stale balance as toAmount.
      amount: balance,
      vaultId: 'vault-public-key',
      localPartyId: 'party-1',
      libType: 'DKLS',
      walletCore: {} as never,
      ...keyInput,
    })

  beforeEach(() => {
    vi.clearAllMocks()
    getCoinBalanceMock.mockResolvedValue(balance)
    getKeysignUtxoInfoMock.mockResolvedValue(undefined)
    getChainSpecificMock.mockResolvedValue({
      case: 'ethereumSpecific',
      value: create(EthereumSpecificSchema, {
        gasLimit,
        maxFeePerGasWei,
        priorityFee: '0',
        nonce: 0n,
      }),
    })
  })

  it('recaps a native-max send signed via hexPublicKeyOverride (publicKey = null)', async () => {
    const payload = await buildMaxSend({
      publicKey: null,
      hexPublicKeyOverride: `02${'ab'.repeat(32)}`,
    })

    expect(BigInt(payload.toAmount)).toBe(balance - fee)
  })

  it('recaps a native-max send identically on the normal publicKey path', async () => {
    const payload = await buildMaxSend({ publicKey: fakePublicKey })

    expect(BigInt(payload.toAmount)).toBe(balance - fee)
  })
})
