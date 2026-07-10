import { describe, expect, it, vi } from 'vitest'

import { Chain } from '../Chain'
import { isValidAddress } from './isValidAddress'

describe('isValidAddress for Ripple', () => {
  it('accepts a valid mainnet X-address even when WalletCore only accepts classic addresses', () => {
    const walletCore = {
      CoinType: { xrp: 144 },
      AnyAddress: { isValid: vi.fn(() => false) },
    }

    expect(
      isValidAddress({
        chain: Chain.Ripple,
        address: 'XV5sbjUmgPpvXv4ixFWZ5ptAYZ6PD2q1qM6owqNbug8W6KV',
        walletCore: walletCore as never,
      })
    ).toBe(true)
  })

  it('does not let WalletCore re-accept an unsupported tag-zero X-address', () => {
    const walletCore = {
      CoinType: { xrp: 144 },
      AnyAddress: { isValid: vi.fn(() => true) },
    }

    expect(
      isValidAddress({
        chain: Chain.Ripple,
        address: 'XV5sbjUmgPpvXv4ixFWZ5ptAYZ6PD2m4Er6SnvjVLpMWPjR',
        walletCore: walletCore as never,
      })
    ).toBe(false)
    expect(walletCore.AnyAddress.isValid).not.toHaveBeenCalled()
  })
})
