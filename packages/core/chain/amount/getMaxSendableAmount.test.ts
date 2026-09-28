import { Chain } from '@vultisig/core-chain/Chain'
import { bittensorConfig } from '@vultisig/core-chain/chains/bittensor/config'
import { describe, expect, it } from 'vitest'

import { getMaxSendableAmount } from './getMaxSendableAmount'

describe('getMaxSendableAmount', () => {
  it('is balance minus fee on a chain that lets an account empty itself', () => {
    expect(getMaxSendableAmount({ chain: Chain.Ethereum, balance: 1_000_000n, fee: 21_000n })).toBe(979_000n)
  })

  // A keep-alive TAO transfer is refused on-chain when it would leave the
  // sender under the 500 rao existential deposit, so the quoted MAX has to
  // keep that much back on top of the fee.
  it('keeps the existential deposit back on Bittensor', () => {
    const balance = 1_000_000_000n
    const fee = 200_000n

    const max = getMaxSendableAmount({ chain: Chain.Bittensor, balance, fee })

    expect(max).toBe(balance - fee - bittensorConfig.existentialDeposit)
    expect(balance - max - fee).toBeGreaterThanOrEqual(500n)
  })

  // An explicit empty-the-account send is signed as transfer_allow_death, so
  // the deposit the chain would otherwise refuse to release is spendable.
  it('keeps nothing back on Bittensor when the send is allowed to reap the account', () => {
    const balance = 1_000_000_000n
    const fee = 200_000n

    expect(getMaxSendableAmount({ chain: Chain.Bittensor, balance, fee, allowDeath: true })).toBe(balance - fee)
  })

  it('is zero when the balance does not cover the fee and the retained deposit', () => {
    expect(getMaxSendableAmount({ chain: Chain.Bittensor, balance: 200_400n, fee: 200_000n })).toBe(0n)
  })
})
