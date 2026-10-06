import {
  NAMED_GAS_FEE,
  SENDER_PUBLIC_KEY,
  setupTransport,
} from '@vultisig/core-chain/chains/near/__tests__/nearRpcTestKit'
import { buildNearKeysignPayload } from '@vultisig/core-mpc/keysign/tests/helpers/nearKeysignPayload'
import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import type { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'
import { Buffer } from 'buffer'

import { getFeeAmount } from '../index'
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

describe('NEAR fee through the registered resolver', () => {
  it('returns the frozen gas reservation as the fee', async () => {
    setupTransport({})

    const payload = buildNearKeysignPayload()

    await expect(getFeeAmount({ keysignPayload: payload, walletCore, publicKey })).resolves.toBe(NAMED_GAS_FEE)
  })

  it.each([[''], ['1.5'], ['-1'], ['0x10']])(
    'rejects a gas reservation that is not unsigned decimal %j',
    async gasFee => {
      setupTransport({})

      await expect(
        getFeeAmount({ keysignPayload: buildNearKeysignPayload({ gasFee }), walletCore, publicKey })
      ).rejects.toThrow(/decimal integer/)
    }
  )
})
