import {
  AMOUNT,
  NAMED_GAS_FEE,
  SENDER_PUBLIC_KEY,
  setupTransport,
} from '@vultisig/core-chain/chains/near/__tests__/nearRpcTestKit'
import { buildNearKeysignPayload } from '@vultisig/core-mpc/keysign/tests/helpers/nearKeysignPayload'
import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import type { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'
import { Buffer } from 'buffer'

import { refineKeysignAmount } from './amount'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({ queryUrl: vi.fn() }))

// eslint-disable-next-line import/order
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

let walletCore: WalletCore
let publicKey: PublicKey

beforeAll(async () => {
  walletCore = await initWasm()
  publicKey = walletCore.PublicKey.createWithData(
    Buffer.from(SENDER_PUBLIC_KEY, 'hex'),
    walletCore.PublicKeyType.ed25519
  )
})

afterAll(() => {
  publicKey.delete()
})

beforeEach(() => {
  vi.mocked(queryUrl).mockReset()
})

describe('NEAR regular sends cannot be quietly reduced', () => {
  it('keeps an affordable regular amount exactly as requested', async () => {
    setupTransport({})

    const payload = buildNearKeysignPayload({ toAmount: '1000' })

    const refined = await refineKeysignAmount({
      keysignPayload: payload,
      walletCore,
      publicKey,
      balance: BigInt(AMOUNT),
    })

    expect(refined.toAmount).toBe('1000')
  })

  it('rejects an over-balance send instead of lowering the amount', async () => {
    setupTransport({})

    const payload = buildNearKeysignPayload({ toAmount: '1000' })

    await expect(
      refineKeysignAmount({
        keysignPayload: payload,
        walletCore,
        publicKey,
        balance: BigInt(NAMED_GAS_FEE) + 999n,
      })
    ).rejects.toThrow(/not enough|needs/i)
  })

  it('rejects a send that would leave the account unable to back its own storage', async () => {
    setupTransport({ account: { storage_usage: 1_000 } })

    const payload = buildNearKeysignPayload({ toAmount: '1000' })
    // One yoctoNEAR short of amount + gas reservation + the 1e22 storage reserve.
    const balance = NAMED_GAS_FEE + 10_000_000_000_000_000_000_000n + 999n

    await expect(refineKeysignAmount({ keysignPayload: payload, walletCore, publicKey, balance })).rejects.toThrow(
      /storage reserve/
    )
  })
})
