import { create } from '@bufbuild/protobuf'
import { describe, expect, it, vi } from 'vitest'

import { Chain } from '@vultisig/core-chain/Chain'

import { CoinSchema } from '../../../types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '../../../types/vultisig/keysign/v1/keysign_message_pb'

const SENDER = 'rSenderAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const DEST_FUNDED = 'rFundedBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
const DEST_UNFUNDED = 'rFreshCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'

// base_fee 10, load_factor==load_base ⇒ computedFee = 10*2 = 20 ⇒ networkFee 20.
const RESERVE_BASE = 1_000_000
const EXPECTED_NETWORK_FEE = 20n

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
    return { account_data: { Sequence: 5 }, ledger_current_index: 100 }
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
    const res = await getRippleChainSpecific({ keysignPayload: payload(DEST_FUNDED, '1000') })
    expect(res.gas).toBe(EXPECTED_NETWORK_FEE)
  })

  it('unfunded destination with amount >= reserve: gas is STILL the network fee only', async () => {
    // The old bug inflated gas to networkFee + reserve_base (~1 XRP burned).
    const res = await getRippleChainSpecific({
      keysignPayload: payload(DEST_UNFUNDED, String(RESERVE_BASE)),
    })
    expect(res.gas).toBe(EXPECTED_NETWORK_FEE)
    expect(res.gas).toBeLessThan(BigInt(RESERVE_BASE))
  })

  it('unfunded destination with amount < reserve: rejects instead of building a doomed/wasteful tx', async () => {
    await expect(getRippleChainSpecific({ keysignPayload: payload(DEST_UNFUNDED, '500000') })).rejects.toThrow(
      /not yet activated|base reserve/i
    )
  })
})
