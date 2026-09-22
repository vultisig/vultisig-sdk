import { PublicKey } from '@solana/web3.js'
import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { getCoinBalance } from '@vultisig/core-chain/coin/balance'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { rent, recentFees } = vi.hoisted(() => ({ rent: vi.fn(), recentFees: vi.fn() }))
vi.mock('@vultisig/core-chain/chains/solana/client', () => ({
  getSolanaClient: () => ({
    getMinimumBalanceForRentExemption: rent,
    getRecentPrioritizationFees: recentFees,
    getLatestBlockhash: async () => ({
      blockhash: '44jzmJEahEFTHexSNLkLfXXXyKggtpT2jJuJ3hdCBbsB',
      lastValidBlockHeight: 100,
    }),
  }),
}))
vi.mock('@vultisig/core-chain/coin/balance', () => ({ getCoinBalance: vi.fn() }))
vi.mock('@vultisig/mpc-types', () => ({ getMpcEngine: vi.fn() }))

import { computeMaxSendFromBalance, getMaxSendAmountFromKeys } from '@/tools/prep/maxSend'
import { prepareSendTxFromKeys } from '@/tools/prep/send'

const sender = '4CC9pEuxAdbxkmt7JmXtdyUn7ZwYkW7ZM4qiHEZUWzkw'
const receiver = 'Eukec6rhM9gwJBB7n38V1ized852M7vQ7nfSgjVMsbKz'
const identity = {
  ecdsaPublicKey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  eddsaPublicKey: Buffer.from(new PublicKey(sender).toBytes()).toString('hex'),
  hexChainCode: '00'.repeat(32),
  localPartyId: 'test',
  libType: 'DKLS' as const,
}
const coin = { chain: Chain.Solana, address: sender, ticker: 'SOL', decimals: 9 }

describe('SOL MAX through the real fee and payload builders', () => {
  let walletCore: WalletCore
  beforeAll(async () => {
    walletCore = await initWasm()
  })
  beforeEach(() => {
    rent.mockReset().mockResolvedValue(650240)
    recentFees
      .mockReset()
      .mockResolvedValue(Array.from({ length: 5 }, (_, slot) => ({ slot, prioritizationFee: 1000001 })))
  })
  it.each([0n, 1n, 105000n, 105001n, 755240n, 755241n, 755242n, 10000000n])(
    'quotes safely at balance %s, including below the network fee',
    async balance => {
      vi.mocked(getCoinBalance).mockResolvedValue(balance)
      const expected = { balance, fee: 105001n, maxSendable: balance > 755241n ? balance - 755241n : 0n }
      await expect(getMaxSendAmountFromKeys(identity, { coin, receiver }, walletCore)).resolves.toEqual(expected)
      await expect(computeMaxSendFromBalance(identity, { coin, receiver, balance }, walletCore)).resolves.toEqual(
        expected
      )
    }
  )
  it('keeps send preparation affordability checks', async () => {
    vi.mocked(getCoinBalance).mockResolvedValue(1n)
    await expect(prepareSendTxFromKeys(identity, { coin, receiver, amount: 1n }, walletCore)).rejects.toThrow()
  })
  it('propagates reserve RPC failures through the real fee path', async () => {
    vi.mocked(getCoinBalance).mockResolvedValue(10000000n)
    rent.mockRejectedValueOnce(new Error('rent RPC unavailable'))
    await expect(getMaxSendAmountFromKeys(identity, { coin, receiver }, walletCore)).rejects.toThrow(
      'rent RPC unavailable'
    )
  })
})
