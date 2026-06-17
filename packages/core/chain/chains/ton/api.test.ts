/**
 * Regression: jetton wallet lookups must (1) query toncenter v3 with
 * `owner_address` + `jetton_address`, and (2) filter the response by the
 * requested owner + jetton master rather than blindly taking the first entry.
 *
 * The Vultisig proxy can return an unfiltered global list (every jetton wallet,
 * any owner). Taking `jetton_wallets[0]` then surfaces a stranger's balance —
 * e.g. a whale's 200M USDT instead of the user's actual 0.
 */
import { describe, expect, it, vi } from 'vitest'

import { tonAddressToRaw } from './address'

const OWNER = 'EQDAFuDWly4z3eA16Ej_JHpoL6CcXdt0IRUrODKKsu60HYMi'
const MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs' // USDT mainnet

const RAW_OWNER = tonAddressToRaw(OWNER)
const RAW_MASTER = tonAddressToRaw(MASTER)

const OWNER_WALLET = {
  address: '0:abc123',
  owner: RAW_OWNER.toUpperCase(),
  jetton: RAW_MASTER.toUpperCase(),
  balance: '5000000000',
}

const STRANGER_WALLET = {
  address: '0:def456',
  owner: '0:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  jetton: RAW_MASTER.toUpperCase(),
  balance: '200000000000000',
}

const capturedUrls: string[] = []
let mockWallets: Array<typeof OWNER_WALLET> = []

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: (url: string) => {
    capturedUrls.push(url)
    return Promise.resolve({
      jetton_wallets: mockWallets,
      address_book: { '0:abc123': { user_friendly: 'EQAbc123' } },
    })
  },
}))

const { getJettonBalance, getJettonWalletAddress } = await import('./api')

const reset = (wallets: Array<typeof OWNER_WALLET>) => {
  capturedUrls.length = 0
  mockWallets = wallets
}

describe('getJettonWalletAddress', () => {
  it('uses owner_address + jetton_address in the proxy request URL', async () => {
    reset([OWNER_WALLET])

    await getJettonWalletAddress({ ownerAddress: OWNER, jettonMasterAddress: MASTER })

    const url = capturedUrls[0] ?? ''
    expect(url).toContain('owner_address=')
    expect(url).toContain('jetton_address=')
    expect(url).not.toContain('owner_id=')
    expect(url).not.toContain('jetton_master_id=')
  })

  it('returns the user_friendly address from the address_book', async () => {
    reset([OWNER_WALLET])

    const address = await getJettonWalletAddress({ ownerAddress: OWNER, jettonMasterAddress: MASTER })

    expect(address).toBe('EQAbc123')
  })

  it('throws when no wallet matches the requested owner', async () => {
    reset([STRANGER_WALLET])

    await expect(getJettonWalletAddress({ ownerAddress: OWNER, jettonMasterAddress: MASTER })).rejects.toThrow(
      'No jetton wallet found'
    )
  })
})

describe('getJettonBalance', () => {
  it('uses owner_address + jetton_address in the proxy request URL', async () => {
    reset([OWNER_WALLET])

    await getJettonBalance({ ownerAddress: OWNER, jettonMasterAddress: MASTER })

    const url = capturedUrls[0] ?? ''
    expect(url).toContain('owner_address=')
    expect(url).toContain('jetton_address=')
    expect(url).not.toContain('owner_id=')
    expect(url).not.toContain('jetton_master_id=')
  })

  it('returns the balance of the wallet owned by the requested owner', async () => {
    reset([OWNER_WALLET])

    const balance = await getJettonBalance({ ownerAddress: OWNER, jettonMasterAddress: MASTER })

    expect(balance).toBe(5000000000n)
  })

  it('ignores other owners in an unfiltered list and returns 0 when the owner is absent', async () => {
    reset([STRANGER_WALLET])

    const balance = await getJettonBalance({ ownerAddress: OWNER, jettonMasterAddress: MASTER })

    expect(balance).toBe(0n)
  })

  it('selects the owner wallet even when a stranger wallet comes first', async () => {
    reset([STRANGER_WALLET, OWNER_WALLET])

    const balance = await getJettonBalance({ ownerAddress: OWNER, jettonMasterAddress: MASTER })

    expect(balance).toBe(5000000000n)
  })
})
