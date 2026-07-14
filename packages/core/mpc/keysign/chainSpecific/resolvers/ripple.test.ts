import { create } from '@bufbuild/protobuf'
import { describe, expect, it, vi } from 'vitest'

import { Chain } from '@vultisig/core-chain/Chain'

import { BuildKeysignPayloadError } from '../../error'
import { CoinSchema } from '../../../types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '../../../types/vultisig/keysign/v1/keysign_message_pb'

const SENDER = 'rSenderAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const DEST_FUNDED = 'rFundedBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
const DEST_UNFUNDED = 'rFreshCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'

// base_fee 10, load_factor==load_base ⇒ computedFee = 10*2 = 20 ⇒ networkFee 20.
const RESERVE_BASE = 1_000_000
const EXPECTED_NETWORK_FEE = 20n
const REQUIRE_DESTINATION_TAG = 0x00020000

const accountInfo = (flags = 0) => ({
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
  ledger_current_index: 100,
})

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
    const res = await getRippleChainSpecific({ keysignPayload: payload(DEST_FUNDED, '1000'), walletCore: {} as never })
    expect(res.gas).toBe(EXPECTED_NETWORK_FEE)
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
      getRippleChainSpecific({ keysignPayload: payload(DEST_UNFUNDED, '500000'), walletCore: {} as never })
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
      getRippleChainSpecific({ keysignPayload: payload(DEST_FUNDED, '1000000'), walletCore: {} as never })
    ).rejects.toMatchObject({ type: 'ripple-destination-tag-required' })
  })

  it('accepts a legacy zero memo as a valid DestinationTag', async () => {
    const { getRippleAccountInfo } = await import('@vultisig/core-chain/chains/ripple/account/info')
    vi.mocked(getRippleAccountInfo).mockImplementation(async address =>
      accountInfo(address === DEST_FUNDED ? REQUIRE_DESTINATION_TAG : 0)
    )
    const keysignPayload = payload(DEST_FUNDED, '1000000')
    keysignPayload.memo = '0'

    const result = await getRippleChainSpecific({ keysignPayload, walletCore: {} as never })
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
