import { Chain } from '@vultisig/core-chain/Chain'
import {
  AMOUNT,
  IMPLICIT_STORAGE_USAGE,
  SENDER,
  setupTransport,
} from '@vultisig/core-chain/chains/near/__tests__/nearRpcTestKit'
import { getNearAccount } from '@vultisig/core-chain/chains/near/api'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getCoinBalance } from '../index'

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({ queryUrl: vi.fn() }))

beforeEach(() => {
  vi.mocked(queryUrl).mockReset()
})

describe('NEAR native balance through the registered resolver', () => {
  it('reports the raw unlocked amount, keeping the storage stake visible in the balance', async () => {
    setupTransport({ account: { amount: AMOUNT, locked: '5', storage_usage: IMPLICIT_STORAGE_USAGE } })

    await expect(getCoinBalance({ chain: Chain.Near, address: SENDER })).resolves.toBe(BigInt(AMOUNT))
  })

  it('reports an unfunded account as zero without hiding a network failure', async () => {
    setupTransport({ account: { unknown: true } })

    await expect(getCoinBalance({ chain: Chain.Near, address: SENDER })).resolves.toBe(0n)
  })

  it.each([[new Error('503 Service Unavailable')], [new Error('fetch failed')]])(
    'propagates a transport failure instead of returning zero (%s)',
    async failure => {
      vi.mocked(queryUrl).mockRejectedValue(failure)

      await expect(getCoinBalance({ chain: Chain.Near, address: SENDER })).rejects.toThrow(failure.message)
    }
  )

  it('rejects an unsupported NEAR token balance instead of reporting zero', async () => {
    setupTransport({})

    await expect(getCoinBalance({ chain: Chain.Near, address: SENDER, id: 'usdc.near' })).rejects.toThrow(/NEP-141/)
  })

  it('rejects a malformed amount instead of rounding it', async () => {
    vi.mocked(queryUrl).mockResolvedValue(
      JSON.stringify({ result: { amount: '1.5', locked: '0', storage_usage: IMPLICIT_STORAGE_USAGE } })
    )

    await expect(getNearAccount(SENDER)).rejects.toThrow(/decimal integer/)
  })
})
