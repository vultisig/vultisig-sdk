import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { initWasm, TW, WalletCore } from '@trustwallet/wallet-core'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const { mockListCoins, mockGetReferenceGasPrice, mockSimulateTransaction } = vi.hoisted(() => ({
  mockListCoins: vi.fn(),
  mockGetReferenceGasPrice: vi.fn(async () => ({ referenceGasPrice: '1000' })),
  mockSimulateTransaction: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/sui/client', () => ({
  getSuiClient: () => ({
    listCoins: mockListCoins,
    getReferenceGasPrice: mockGetReferenceGasPrice,
    simulateTransaction: mockSimulateTransaction,
  }),
}))

import { maxSuiInputCoinObjects } from '../../../suiCoinSelection'
import { CoinSchema } from '../../../../types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '../../../../types/vultisig/keysign/v1/keysign_message_pb'
import { getSuiSigningInputs } from '../../../signingInputs/resolvers/sui'
import { getSuiChainSpecific } from './index'

const NATIVE_TYPE = '0x2::sui::SUI'
const SENDER = '0x0000000000000000000000000000000000000000000000000000000000000abc'
const RECIPIENT = '0x51d5b8e2f3d2f0aef0aefdc4e6c0f4f3d2b1a09788c7e6f5d4c3b2a190817263'

// Unified-client coin object shape: `objectId` + the full `Coin<...>` wrapper type.
const makeRpcCoin = (i: number, balance: string) => ({
  objectId: `0x${(1000 + i).toString(16).padStart(64, '0')}`,
  version: `${i + 1}`,
  digest: '5PLj4rE6ZP1AXwT9CkyzX1zNvfSFVAKUB7T5uf5RCXvY',
  type: `0x2::coin::Coin<${NATIVE_TYPE}>`,
  balance,
  owner: { $kind: 'AddressOwner', AddressOwner: SENDER },
})

let walletCore: WalletCore

beforeAll(async () => {
  walletCore = await initWasm()
})

const buildPayload = (amount: bigint) =>
  create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: Chain.Sui,
      ticker: 'SUI',
      address: SENDER,
      decimals: 9,
      isNativeToken: true,
    }),
    toAddress: RECIPIENT,
    toAmount: amount.toString(),
  })

// Fixture mirrors the deep-wave repro for sdk#1216's follow-up gap: 300
// equal-sized native objects, well under the 255-object cap (isolates the
// refine-budget-escalation invariant from the cap invariant), sized so the
// baseline (pre-refine) payload selection has ZERO slack against the static
// `suiGasBudget` default.
const wallet = Array.from({ length: 300 }, (_, i) => makeRpcCoin(i, '50000'))

// Simulation result union carrying the priced gas breakdown.
const simulation = (computationCost: string, storageCost: string) => ({
  $kind: 'Transaction' as const,
  Transaction: {
    status: { success: true, error: null },
    effects: {
      transactionDigest: '5PLj4rE6ZP1AXwT9CkyzX1zNvfSFVAKUB7T5uf5RCXvY',
      gasUsed: { computationCost, storageCost, storageRebate: '0', nonRefundableStorageFee: '0' },
    },
  },
})

// computationCost + storageCost = 3_000_000 -> gasBudgetMultiplier (*1.15) =
// 3_450_000, above the 3_000_000 static baseline used to size the initial
// (simulated) payload selection.
const dryRunResponse = simulation('2000000', '1000000')

const singlePage = (objects: unknown[]) => ({ objects, hasNextPage: false, cursor: null })

describe('getSuiChainSpecific -> refine -> getSuiSigningInputs (full pipeline, refine NOT stubbed)', () => {
  it('re-selects payload coins against the REFINED budget so the final signing input covers the budget it declares', async () => {
    mockListCoins.mockReset().mockResolvedValueOnce(singlePage(wallet))
    // Selection grows 140 -> 149 (see below), so refine's converge loop fires
    // ONE re-price round. The re-price reports the SAME cost as the first
    // simulation, so it converges immediately without growing further — the
    // "typical path converges in one round" case the loop bound's comment describes.
    mockSimulateTransaction.mockReset().mockResolvedValueOnce(dryRunResponse).mockResolvedValueOnce(dryRunResponse)

    const amount = 4_000_000n
    const keysignPayload = buildPayload(amount)

    const chainSpecific = await getSuiChainSpecific({
      keysignPayload,
      walletCore,
    })

    // Refine actually landed (not the attempt/withFallback error path).
    expect(chainSpecific.gasBudget).toBe('3450000')
    expect(mockSimulateTransaction).toHaveBeenCalledTimes(2)

    const target = amount + BigInt(chainSpecific.gasBudget)
    const payloadTotal = chainSpecific.coins.reduce((sum, c) => sum + BigInt(c.balance), 0n)
    // The bug this test pins: pre-fix, the payload was narrowed against the
    // BASELINE budget (3_000_000) before refine ran, so it fell short of the
    // refined target (3_450_000) even though the wallet held far more.
    expect(payloadTotal).toBeGreaterThanOrEqual(target)
    expect(chainSpecific.coins.length).toBeLessThanOrEqual(maxSuiInputCoinObjects)

    // Feed the refined chainSpecific into the FINAL signing-input build (the
    // same shared payload every co-signer independently recomputes from) and
    // assert the actual TW.Sui.Proto.SigningInput references enough balance
    // to cover the budget it itself declares.
    const finalPayload = create(KeysignPayloadSchema, {
      ...keysignPayload,
      blockchainSpecific: { case: 'suicheSpecific', value: chainSpecific },
    })
    const [signingInput] = getSuiSigningInputs({
      keysignPayload: finalPayload,
      walletCore,
    }) as unknown as TW.Sui.Proto.SigningInput[]

    const byObjectId = new Map(chainSpecific.coins.map(c => [c.coinObjectId, c]))
    const inputCoins = signingInput.paySui!.inputCoins!
    const inputTotal = inputCoins.reduce((sum, ref) => sum + BigInt(byObjectId.get(ref!.objectId!)!.balance), 0n)
    expect(inputTotal).toBeGreaterThanOrEqual(target)
    expect(inputCoins.length).toBeLessThanOrEqual(maxSuiInputCoinObjects)

    // Deterministic: an identical wallet + simulation responses select the
    // identical object set on a second run.
    mockListCoins.mockReset().mockResolvedValueOnce(singlePage(wallet))
    mockSimulateTransaction.mockReset().mockResolvedValueOnce(dryRunResponse).mockResolvedValueOnce(dryRunResponse)
    const again = await getSuiChainSpecific({
      keysignPayload: buildPayload(amount),
      walletCore,
    })
    expect(again.coins.map(c => c.coinObjectId)).toEqual(chainSpecific.coins.map(c => c.coinObjectId))
  })

  it('simulates the raw BCS bytes with the intent prefix stripped', async () => {
    mockListCoins.mockReset().mockResolvedValueOnce(singlePage(wallet))
    mockSimulateTransaction.mockReset().mockResolvedValueOnce(dryRunResponse).mockResolvedValueOnce(dryRunResponse)

    await getSuiChainSpecific({ keysignPayload: buildPayload(4_000_000n), walletCore })

    const request = mockSimulateTransaction.mock.calls[0]?.[0]
    // Raw bytes, NOT the base64 string the retired dryRunTransactionBlock took.
    expect(request.transaction).toBeInstanceOf(Uint8Array)
    expect(request.include).toEqual({ effects: true })
    // WalletCore's 3-byte intent prefix (0x00 0x00 0x00 for a Sui TransactionData)
    // must be stripped — the chain wants bare TransactionData BCS.
    expect(Array.from(request.transaction.slice(0, 3))).not.toEqual([0, 0, 0])
  })

  it('fails closed when a simulation returns no gas breakdown at all', async () => {
    mockListCoins.mockReset().mockResolvedValueOnce(singlePage(wallet))
    // A response with effects but no gasUsed cannot price the budget; refine must
    // throw rather than silently price the send at 0.
    mockSimulateTransaction.mockReset().mockResolvedValue({
      $kind: 'Transaction',
      Transaction: { status: { success: true, error: null }, effects: { transactionDigest: 'x' } },
    })

    // The initial refinement failure is caught by design and falls back to the
    // static baseline, so assert on the baseline rather than a throw.
    const res = await getSuiChainSpecific({ keysignPayload: buildPayload(4_000_000n), walletCore })
    expect(res.gasBudget).toBe('3000000')
  })

  it('fails closed after 2 re-price rounds when the simulated cost keeps climbing', async () => {
    // Each round's re-price reports a HIGHER cost than the last, so the
    // selection keeps growing (140 -> 149 -> 154 -> 159) and would keep
    // triggering further rounds forever if unbounded. The loop must stop
    // after exactly 2 extra rounds (3 simulations total) and reject the unpriced
    // final selection rather than returning it.
    mockListCoins.mockReset().mockResolvedValueOnce(singlePage(wallet))
    mockSimulateTransaction
      .mockReset()
      // Round 0 (baseline, 140 objects): 3_000_000 -> budget 3_450_000, grows to 149.
      .mockResolvedValueOnce(simulation('2000000', '1000000'))
      // Round 1 (re-price on 149 objects): 3_200_000 -> budget 3_680_000, grows to 154.
      .mockResolvedValueOnce(simulation('2100000', '1100000'))
      // Round 2 (re-price on 154 objects): 3_400_000 -> budget 3_910_000, grows to 159.
      .mockResolvedValueOnce(simulation('2200000', '1200000'))

    const amount = 4_000_000n
    const keysignPayload = buildPayload(amount)

    await expect(getSuiChainSpecific({ keysignPayload, walletCore })).rejects.toThrow(
      'Sui gas budget did not converge after 2 re-price rounds'
    )

    // Exactly 1 (baseline) + 2 (the bound) simulations — never a 4th, even though
    // the round-2 selection (159 objects) still grew past round-1's (154).
    expect(mockSimulateTransaction).toHaveBeenCalledTimes(3)
  })

  it('fails closed when re-pricing errors after the initial selection grows', async () => {
    mockListCoins.mockReset().mockResolvedValueOnce(singlePage(wallet))
    mockSimulateTransaction
      .mockReset()
      .mockResolvedValueOnce(dryRunResponse)
      .mockRejectedValueOnce(new Error('Sui re-price RPC unavailable'))

    await expect(
      getSuiChainSpecific({
        keysignPayload: buildPayload(4_000_000n),
        walletCore,
      })
    ).rejects.toThrow('Sui re-price RPC unavailable')

    expect(mockSimulateTransaction).toHaveBeenCalledTimes(2)
  })

  it('fails closed when a refined budget exceeds the available wallet balance', async () => {
    mockListCoins.mockReset().mockResolvedValueOnce(singlePage(wallet))
    mockSimulateTransaction.mockReset().mockResolvedValueOnce(simulation('10000000', '4000000'))

    await expect(
      getSuiChainSpecific({
        keysignPayload: buildPayload(4_000_000n),
        walletCore,
      })
    ).rejects.toThrow('Insufficient Sui coin balance to cover 20100000')

    expect(mockSimulateTransaction).toHaveBeenCalledTimes(1)
  })
})
