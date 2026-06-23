import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetPublicKey, mockGetWalletCore } = vi.hoisted(() => ({
  mockGetPublicKey: vi.fn(),
  mockGetWalletCore: vi.fn(),
}))

vi.mock('@vultisig/core-chain/publicKey/getPublicKey', () => ({
  getPublicKey: mockGetPublicKey,
}))
vi.mock('@/context/wasmRuntime', () => ({
  getWalletCore: mockGetWalletCore,
}))
vi.mock('@vultisig/mpc-types', () => ({
  getMpcEngine: vi.fn(),
}))

import type { VaultIdentity } from '@/tools/prep/types'
import { CONSOLIDATE_CHAINS, prepareUtxoConsolidateTxFromKeys } from '@/tools/prep/utxoConsolidate'

const baseIdentity: VaultIdentity = {
  ecdsaPublicKey: '02ecdsa-public-key',
  eddsaPublicKey: 'eddsa-public-key',
  hexChainCode: 'deadbeef',
  localPartyId: 'iPhone-A1B2',
  libType: 'DKLS',
}

const mockWalletCore = { __mock: 'walletCore' }
// publicKey.data() returns bytes; Buffer.from(...).toString('hex') => 'aabbcc'
const mockPublicKey = { data: () => new Uint8Array([0xaa, 0xbb, 0xcc]) }

const btcCoin = {
  chain: Chain.Bitcoin,
  address: 'bc1qself',
  decimals: 8,
  ticker: 'BTC',
} as any

const sampleUtxos = [
  { hash: 'aaaa', index: 0, value: 50_000n },
  { hash: 'bbbb', index: 1, value: 30_000n },
  { hash: 'cccc', index: 2, value: 20_000n },
]

describe('prepareUtxoConsolidateTxFromKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWalletCore.mockResolvedValue(mockWalletCore)
    mockGetPublicKey.mockReturnValue(mockPublicKey)
  })

  it('builds an unsigned send-max-to-self KeysignPayload from explicit UTXOs', async () => {
    const result = await prepareUtxoConsolidateTxFromKeys(baseIdentity, {
      coin: btcCoin,
      utxos: sampleUtxos,
      byteFee: 12n,
    })

    // vsize = 10 + 3*68 + 34 = 248 ; fee = 248 * 12 = 2976
    expect(result.inputCount).toBe(3)
    expect(result.totalInput).toBe(100_000n)
    expect(result.fee).toBe(2_976n)
    expect(result.outputAmount).toBe(97_024n)

    const p = result.keysignPayload
    // Send-to-self: output goes back to the same address.
    expect(p.toAddress).toBe('bc1qself')
    expect(p.coin?.address).toBe('bc1qself')
    expect(p.toAmount).toBe('97024')
    expect(p.vaultPublicKeyEcdsa).toBe(baseIdentity.ecdsaPublicKey)
    expect(p.vaultLocalPartyId).toBe(baseIdentity.localPartyId)
    expect(p.coin?.hexPublicKey).toBe('aabbcc')

    // All explicit inputs flow through; no network fetch.
    expect(p.utxoInfo).toHaveLength(3)
    expect(p.utxoInfo.map(u => u.hash)).toEqual(['aaaa', 'bbbb', 'cccc'])
    expect(p.utxoInfo.map(u => u.amount)).toEqual([50_000n, 30_000n, 20_000n])

    // sendMaxAmount sweeps everything; byteFee carried through.
    expect(p.blockchainSpecific.case).toBe('utxoSpecific')
    if (p.blockchainSpecific.case === 'utxoSpecific') {
      expect(p.blockchainSpecific.value.sendMaxAmount).toBe(true)
      expect(p.blockchainSpecific.value.byteFee).toBe('12')
    }
  })

  it('uses the explicit walletCore override and never calls the global getWalletCore', async () => {
    const overrideWalletCore = { __mock: 'override' }
    await prepareUtxoConsolidateTxFromKeys(
      baseIdentity,
      { coin: btcCoin, utxos: sampleUtxos, byteFee: 5n },
      overrideWalletCore as any
    )
    expect(mockGetWalletCore).not.toHaveBeenCalled()
    expect(mockGetPublicKey.mock.calls[0][0].walletCore).toBe(overrideWalletCore)
  })

  it('rejects an unsupported chain', async () => {
    await expect(
      prepareUtxoConsolidateTxFromKeys(baseIdentity, {
        coin: { ...btcCoin, chain: Chain.Ethereum },
        utxos: sampleUtxos,
        byteFee: 5n,
      })
    ).rejects.toThrow(/Unsupported chain for consolidation/)
  })

  it('rejects when there is nothing to consolidate (<= 1 UTXO)', async () => {
    await expect(
      prepareUtxoConsolidateTxFromKeys(baseIdentity, {
        coin: btcCoin,
        utxos: [{ hash: 'aaaa', index: 0, value: 50_000n }],
        byteFee: 5n,
      })
    ).rejects.toThrow(/Nothing to consolidate/)
  })

  it('rejects a non-positive byteFee', async () => {
    await expect(
      prepareUtxoConsolidateTxFromKeys(baseIdentity, {
        coin: btcCoin,
        utxos: sampleUtxos,
        byteFee: 0n,
      })
    ).rejects.toThrow(/byteFee must be greater than zero/)
  })

  it('rejects when the fee would exceed the total input (uneconomical)', async () => {
    await expect(
      prepareUtxoConsolidateTxFromKeys(baseIdentity, {
        coin: btcCoin,
        utxos: [
          { hash: 'aaaa', index: 0, value: 100n },
          { hash: 'bbbb', index: 1, value: 100n },
        ],
        byteFee: 1_000n,
      })
    ).rejects.toThrow(/not economical/)
  })

  it('rejects a malformed UTXO value', async () => {
    await expect(
      prepareUtxoConsolidateTxFromKeys(baseIdentity, {
        coin: btcCoin,
        utxos: [
          { hash: 'aaaa', index: 0, value: -1n },
          { hash: 'bbbb', index: 1, value: 30_000n },
        ],
        byteFee: 5n,
      })
    ).rejects.toThrow(/Invalid UTXO value/)
  })

  it('exposes the supported consolidate chain set', () => {
    expect(CONSOLIDATE_CHAINS).toContain(Chain.Bitcoin)
    expect(CONSOLIDATE_CHAINS).toContain(Chain.Dash)
    expect(CONSOLIDATE_CHAINS).not.toContain(Chain.Zcash)
  })
})
