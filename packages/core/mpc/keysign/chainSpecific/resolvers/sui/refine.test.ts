import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { initWasm, TW, WalletCore } from '@trustwallet/wallet-core'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const { mockGetAllCoins, mockGetReferenceGasPrice, mockDryRunTransactionBlock } = vi.hoisted(() => ({
  mockGetAllCoins: vi.fn(),
  mockGetReferenceGasPrice: vi.fn(async () => 1000n),
  mockDryRunTransactionBlock: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/sui/client', () => ({
  getSuiClient: () => ({
    getAllCoins: mockGetAllCoins,
    getReferenceGasPrice: mockGetReferenceGasPrice,
    dryRunTransactionBlock: mockDryRunTransactionBlock,
  }),
}))

import { maxSuiInputCoinObjects } from '../../../../chains/sui/coinSelection'
import { CoinSchema } from '../../../../types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '../../../../types/vultisig/keysign/v1/keysign_message_pb'
import { getSuiSigningInputs } from '../../../signingInputs/resolvers/sui'
import { getSuiChainSpecific } from './index'

const NATIVE_TYPE = '0x2::sui::SUI'
const SENDER = '0x0000000000000000000000000000000000000000000000000000000000000abc'
const RECIPIENT = '0x51d5b8e2f3d2f0aef0aefdc4e6c0f4f3d2b1a09788c7e6f5d4c3b2a190817263'

const makeRpcCoin = (i: number, balance: string) => ({
  coinType: NATIVE_TYPE,
  coinObjectId: `0x${(1000 + i).toString(16).padStart(64, '0')}`,
  version: `${i + 1}`,
  digest: '5PLj4rE6ZP1AXwT9CkyzX1zNvfSFVAKUB7T5uf5RCXvY',
  balance,
  previousTransaction: `0x${(2000 + i).toString(16).padStart(64, '0')}`,
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
// computationCost + storageCost = 3_000_000 -> gasBudgetMultiplier (*1.15) =
// 3_450_000, above the 3_000_000 static baseline used to size the initial
// (dry-run) payload selection.
const dryRunResponse = {
  effects: { gasUsed: { computationCost: '2000000', storageCost: '1000000', storageRebate: '0' } },
}

describe('getSuiChainSpecific -> refine -> getSuiSigningInputs (full pipeline, refine NOT stubbed)', () => {
  it('re-selects payload coins against the REFINED budget so the final signing input covers the budget it declares', async () => {
    mockGetAllCoins.mockReset().mockResolvedValueOnce({ data: wallet, hasNextPage: false, nextCursor: null })
    // Selection grows 140 -> 149 (see below), so refine's converge loop fires
    // ONE re-price round. The re-price reports the SAME cost as the first dry
    // run, so it converges immediately without growing further — the "typical
    // path converges in one round" case the loop bound's comment describes.
    mockDryRunTransactionBlock.mockReset().mockResolvedValueOnce(dryRunResponse).mockResolvedValueOnce(dryRunResponse)

    const amount = 4_000_000n
    const keysignPayload = buildPayload(amount)

    const chainSpecific = await getSuiChainSpecific({ keysignPayload, walletCore })

    // Refine actually landed (not the attempt/withFallback error path).
    expect(chainSpecific.gasBudget).toBe('3450000')
    expect(mockDryRunTransactionBlock).toHaveBeenCalledTimes(2)

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

    // Deterministic: an identical wallet + dry-run responses select the
    // identical object set on a second run.
    mockGetAllCoins.mockReset().mockResolvedValueOnce({ data: wallet, hasNextPage: false, nextCursor: null })
    mockDryRunTransactionBlock.mockReset().mockResolvedValueOnce(dryRunResponse).mockResolvedValueOnce(dryRunResponse)
    const again = await getSuiChainSpecific({ keysignPayload: buildPayload(amount), walletCore })
    expect(again.coins.map(c => c.coinObjectId)).toEqual(chainSpecific.coins.map(c => c.coinObjectId))
  })

  it('bounds the converge loop at 2 re-price rounds even when the dry-run cost keeps climbing', async () => {
    // Each round's re-price reports a HIGHER cost than the last, so the
    // selection keeps growing (140 -> 149 -> 154 -> 159) and would keep
    // triggering further rounds forever if unbounded. The loop must stop
    // after exactly 2 extra rounds (3 dry runs total) and accept the last
    // computed budget/selection rather than looping indefinitely.
    mockGetAllCoins.mockReset().mockResolvedValueOnce({ data: wallet, hasNextPage: false, nextCursor: null })
    mockDryRunTransactionBlock
      .mockReset()
      // Round 0 (baseline, 140 objects): 3_000_000 -> budget 3_450_000, grows to 149.
      .mockResolvedValueOnce({
        effects: { gasUsed: { computationCost: '2000000', storageCost: '1000000', storageRebate: '0' } },
      })
      // Round 1 (re-price on 149 objects): 3_200_000 -> budget 3_680_000, grows to 154.
      .mockResolvedValueOnce({
        effects: { gasUsed: { computationCost: '2100000', storageCost: '1100000', storageRebate: '0' } },
      })
      // Round 2 (re-price on 154 objects): 3_400_000 -> budget 3_910_000, grows to 159.
      .mockResolvedValueOnce({
        effects: { gasUsed: { computationCost: '2200000', storageCost: '1200000', storageRebate: '0' } },
      })

    const amount = 4_000_000n
    const keysignPayload = buildPayload(amount)

    const chainSpecific = await getSuiChainSpecific({ keysignPayload, walletCore })

    // Exactly 1 (baseline) + 2 (the bound) dry runs — never a 4th, even though
    // the round-2 selection (159 objects) still grew past round-1's (154).
    expect(mockDryRunTransactionBlock).toHaveBeenCalledTimes(3)
    expect(chainSpecific.gasBudget).toBe('3910000')
    expect(chainSpecific.coins).toHaveLength(159)

    // The selection accepted at the bound still covers the budget it itself
    // declares, even though a hypothetical round 3 might have priced higher
    // still — the documented fail-safe tradeoff of the bound.
    const target = amount + BigInt(chainSpecific.gasBudget)
    const payloadTotal = chainSpecific.coins.reduce((sum, c) => sum + BigInt(c.balance), 0n)
    expect(payloadTotal).toBeGreaterThanOrEqual(target)
    expect(chainSpecific.coins.length).toBeLessThanOrEqual(maxSuiInputCoinObjects)
  })
})
