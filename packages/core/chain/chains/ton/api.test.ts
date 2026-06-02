/**
 * Regression: getJettonWalletsUrl must use `owner_id` + `jetton_master_id` query params.
 *
 * The Vultisig proxy at /ton/v3/jetton/wallets silently ignores the old
 * `owner_address` / `jetton_address` params and returns an empty array,
 * making every balance call return 0 and every transfer fail with
 * "No jetton wallet found". Parity fix with mcp-ts#324.
 */
import { describe, expect, it, vi } from 'vitest'

const capturedUrls: string[] = []

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: (url: string) => {
    capturedUrls.push(url)
    return Promise.resolve({
      jetton_wallets: [{ address: '0:abc123', jetton: '0:master', balance: '5000000000' }],
      address_book: { '0:abc123': { user_friendly: 'EQAbc123' } },
    })
  },
}))

import { getJettonBalance,getJettonWalletAddress } from './api'

const OWNER = 'EQDAFuDWly4z3eA16Ej_JHpoL6CcXdt0IRUrODKKsu60HYMi'
const MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs' // USDT mainnet

describe('getJettonWalletAddress', () => {
  it('uses owner_id + jetton_master_id in the proxy request URL', async () => {
    capturedUrls.length = 0

    await getJettonWalletAddress({ ownerAddress: OWNER, jettonMasterAddress: MASTER })

    const url = capturedUrls[0] ?? ''
    expect(url).toContain('owner_id=')
    expect(url).toContain('jetton_master_id=')
    expect(url).not.toContain('owner_address=')
    expect(url).not.toContain('jetton_address=')
  })

  it('returns the user_friendly address from the address_book', async () => {
    capturedUrls.length = 0

    const address = await getJettonWalletAddress({ ownerAddress: OWNER, jettonMasterAddress: MASTER })

    expect(address).toBe('EQAbc123')
  })
})

describe('getJettonBalance', () => {
  it('uses owner_id + jetton_master_id in the proxy request URL', async () => {
    capturedUrls.length = 0

    await getJettonBalance({ ownerAddress: OWNER, jettonMasterAddress: MASTER })

    const url = capturedUrls[0] ?? ''
    expect(url).toContain('owner_id=')
    expect(url).toContain('jetton_master_id=')
    expect(url).not.toContain('owner_address=')
    expect(url).not.toContain('jetton_address=')
  })

  it('returns the balance as bigint', async () => {
    capturedUrls.length = 0

    const balance = await getJettonBalance({ ownerAddress: OWNER, jettonMasterAddress: MASTER })

    expect(balance).toBe(5000000000n)
  })
})
