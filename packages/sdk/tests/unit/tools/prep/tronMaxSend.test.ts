import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@vultisig/core-chain/coin/balance', () => ({ getCoinBalance: vi.fn().mockResolvedValue(10_000_000n) }))
vi.mock('@vultisig/core-chain/chains/tron/getTronBlockInfo', () => ({
  getTronBlockInfo: vi.fn().mockResolvedValue({
    timestamp: 1_716_000_000_000,
    expiration: 1_716_003_600_000,
    blockHeaderTimestamp: 1_716_000_000_000,
    blockHeaderNumber: 99_000_000,
    blockHeaderVersion: 30,
    blockHeaderTxTrieRoot: '01'.repeat(32),
    blockHeaderParentHash: '02'.repeat(32),
    blockHeaderWitnessAddress: '03'.repeat(21),
  }),
}))
vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({ queryUrl: vi.fn() }))
vi.mock('@vultisig/mpc-types', () => ({ getMpcEngine: vi.fn() }))

import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { computeMaxSendFromBalance } from '@/tools/prep/maxSend'

const sender = 'TCNkawTmcQgYSU8nP8cHswT1QPjharxJr7'
const receiver = 'THHsfg2eNiv6MSXC4y5d4t5wkvRVADRKiF'
const publicKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
const identity = {
  ecdsaPublicKey: publicKey,
  eddsaPublicKey: '',
  hexChainCode: '00'.repeat(32),
  localPartyId: 'test',
  libType: 'DKLS' as const,
  chainPublicKeys: { [Chain.Tron]: publicKey },
}
const params = {
  coin: { chain: Chain.Tron, address: sender, ticker: 'TRX', decimals: 6 },
  receiver,
  balance: 10_000_000n,
}

describe('TRON MAX send through the real fee and payload builders', () => {
  let walletCore: WalletCore
  beforeAll(async () => {
    walletCore = await initWasm()
  })
  beforeEach(() => {
    vi.mocked(queryUrl).mockReset()
  })

  it.each([0, 600])('reserves activation despite %i free bandwidth', async bandwidth => {
    vi.mocked(queryUrl).mockImplementation(async (url, options) => {
      if (String(url).endsWith('/getaccountresource')) return { freeNetLimit: bandwidth }
      return (options?.body as { address?: string })?.address === receiver ? {} : { address: sender }
    })
    await expect(computeMaxSendFromBalance(identity, params, walletCore)).resolves.toEqual({
      balance: 10_000_000n,
      fee: 1_100_000n,
      maxSendable: 8_900_000n,
    })
  })

  it.each([
    [0, 800_000n],
    [600, 0n],
  ])('preserves activated-recipient fees at %i bandwidth', async (bandwidth, fee) => {
    vi.mocked(queryUrl).mockImplementation(async (url, options) => {
      if (String(url).endsWith('/getaccountresource')) return { freeNetLimit: bandwidth }
      return { address: (options?.body as { address?: string })?.address }
    })
    await expect(computeMaxSendFromBalance(identity, params, walletCore)).resolves.toEqual({
      balance: 10_000_000n,
      fee,
      maxSendable: 10_000_000n - fee,
    })
  })

  it('does not return a MAX amount when recipient lookup fails', async () => {
    vi.mocked(queryUrl).mockRejectedValue(new Error('recipient RPC unavailable'))
    await expect(computeMaxSendFromBalance(identity, params, walletCore)).rejects.toThrow('recipient RPC unavailable')
  })
})
