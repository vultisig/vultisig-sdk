import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetPublicKey, mockGetWalletCore, mockGetChainSpecific } = vi.hoisted(() => ({
  mockGetPublicKey: vi.fn(),
  mockGetWalletCore: vi.fn(),
  mockGetChainSpecific: vi.fn(),
}))

vi.mock('@vultisig/core-chain/publicKey/getPublicKey', () => ({
  getPublicKey: mockGetPublicKey,
}))
vi.mock('@/context/wasmRuntime', () => ({
  getWalletCore: mockGetWalletCore,
}))
vi.mock('@vultisig/core-mpc/keysign/chainSpecific', () => ({
  getChainSpecific: mockGetChainSpecific,
}))

import { prepareThorchainMsgDepositTxFromKeys } from '@/tools/prep/thorchainMsgDeposit'
import type { VaultIdentity } from '@/tools/prep/types'

const baseIdentity: VaultIdentity = {
  ecdsaPublicKey: '02ecdsa-public-key',
  eddsaPublicKey: 'eddsa-public-key',
  hexChainCode: 'deadbeef',
  localPartyId: 'iPhone-A1B2',
  libType: 'DKLS',
}

const mockWalletCore = { __mock: 'walletCore' }
// PublicKey.data() returns a Uint8Array that the helper hex-encodes for the
// keysign payload's `coin.hexPublicKey`. Mock the .data() method to return
// a stable 33-byte compressed-pubkey-shaped buffer.
const mockPublicKey = {
  data: () => new Uint8Array(33).fill(0x02),
} as unknown as any

const thorCoin = {
  chain: Chain.THORChain,
  address: 'thor149ekc6vu5ez775hd7y7ukgdq86e43t88pk7njm',
  decimals: 8,
  ticker: 'RUNE',
} as any

const mayaCoin = {
  chain: Chain.MayaChain,
  address: 'maya1l8tqmlnzhxn30sd03cmq98uju95tw6ucxgkre6',
  decimals: 10,
  ticker: 'CACAO',
} as any

describe('prepareThorchainMsgDepositTxFromKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWalletCore.mockResolvedValue(mockWalletCore)
    mockGetPublicKey.mockReturnValue(mockPublicKey)
    mockGetChainSpecific.mockResolvedValue({
      case: 'thorchainSpecific',
      value: { isDeposit: true, accountNumber: 1n, sequence: 0n, fee: 2000000n },
    })
  })

  it('builds a THORChain MsgDeposit payload with LP add memo and isDeposit=true', async () => {
    const result = await prepareThorchainMsgDepositTxFromKeys(baseIdentity, {
      coin: thorCoin,
      amountBaseUnits: 100_000_000n, // 1 RUNE
      memo: '+:BTC.BTC',
    })

    expect(result.toAddress).toBe('')
    expect(result.toAmount).toBe('100000000')
    expect(result.memo).toBe('+:BTC.BTC')
    expect(result.vaultPublicKeyEcdsa).toBe(baseIdentity.ecdsaPublicKey)
    expect(result.vaultLocalPartyId).toBe(baseIdentity.localPartyId)

    expect(mockGetChainSpecific).toHaveBeenCalledTimes(1)
    expect(mockGetChainSpecific).toHaveBeenCalledWith(
      expect.objectContaining({
        walletCore: mockWalletCore,
        isDeposit: true,
      })
    )
  })

  it('preserves LP add memo with paired_address verbatim', async () => {
    const result = await prepareThorchainMsgDepositTxFromKeys(baseIdentity, {
      coin: thorCoin,
      amountBaseUnits: 500_000_000n,
      memo: '+:BTC.BTC:bc1qzmsk98gqtfvxhfrye8p7xkxlj6g9q6a2yj3yj2',
    })
    expect(result.memo).toBe('+:BTC.BTC:bc1qzmsk98gqtfvxhfrye8p7xkxlj6g9q6a2yj3yj2')
    expect(result.toAmount).toBe('500000000')
  })

  it('preserves LP remove memo (with bps + withdrawToAsset)', async () => {
    const result = await prepareThorchainMsgDepositTxFromKeys(baseIdentity, {
      coin: thorCoin,
      amountBaseUnits: 2_000_000n, // dust
      memo: '-:BTC.BTC:10000:BTC',
    })
    expect(result.memo).toBe('-:BTC.BTC:10000:BTC')
    expect(result.toAmount).toBe('2000000')
  })

  it('builds a MayaChain MsgDeposit payload with CACAO 10-decimal coin', async () => {
    mockGetChainSpecific.mockResolvedValueOnce({
      case: 'mayaSpecific',
      value: { isDeposit: true, accountNumber: 1n, sequence: 0n },
    })
    const result = await prepareThorchainMsgDepositTxFromKeys(baseIdentity, {
      coin: mayaCoin,
      amountBaseUnits: 10_000_000_000n, // 1 CACAO
      memo: '+:BTC.BTC',
    })
    expect(result.toAddress).toBe('')
    expect(result.toAmount).toBe('10000000000')
    expect(result.memo).toBe('+:BTC.BTC')
    expect(mockGetChainSpecific).toHaveBeenCalledWith(
      expect.objectContaining({ isDeposit: true })
    )
  })

  it('rejects non-THORChain/MayaChain chain', async () => {
    await expect(
      prepareThorchainMsgDepositTxFromKeys(baseIdentity, {
        coin: { ...thorCoin, chain: Chain.Cosmos },
        amountBaseUnits: 1n,
        memo: '+:BTC.BTC',
      })
    ).rejects.toThrow(/not supported/i)
  })

  it('rejects zero amount', async () => {
    await expect(
      prepareThorchainMsgDepositTxFromKeys(baseIdentity, {
        coin: thorCoin,
        amountBaseUnits: 0n,
        memo: '+:BTC.BTC',
      })
    ).rejects.toThrow(/amountBaseUnits must be > 0/)
  })

  it('rejects empty memo', async () => {
    await expect(
      prepareThorchainMsgDepositTxFromKeys(baseIdentity, {
        coin: thorCoin,
        amountBaseUnits: 100_000_000n,
        memo: '',
      })
    ).rejects.toThrow(/memo is required/)
  })
})
