/**
 * Real-WalletCore regression for Zcash fee planning in getUtxoSigningInputs.
 * WalletCore's `zip_0317` planner hardcodes 5,000 zats per action, flat-sizes
 * OP_RETURN and ignores `byteFee`, so the resolver never uses it: every Zcash
 * plan runs with `zip_0317` off (where `byteFee` is honoured), raising
 * `byteFee` from 1 until the fee clears the ZIP 2009 conventional fee
 * (1,000 zats per action).
 *
 * The exact fees below are cross-platform vectors: co-signers rebuild the
 * transaction from the same payload, so iOS and Android must plan the same
 * amounts or keysign digests diverge.
 */
import { create } from '@bufbuild/protobuf'
import { initWasm, WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { getZcashConventionalFee, getZcashTransparentOutputSizes } from '@vultisig/core-chain/chains/utxo/fee/zip317'
import { UTXOSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { UtxoInfoSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/utxo_info_pb'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { getUtxoSigningInputs } from './utxo'

vi.mock('@vultisig/core-chain/chains/utxo/zcashBranchId', () => ({
  getZcashBranchIdHex: vi.fn(async () => '30f33754'),
}))

const zcashAddress = 't1PoLLLwEcVhqMBhk53tANtSepnPXAQJkPM'

type BuildPayloadInput = {
  amount: bigint
  balance: bigint
  memo?: string
  sendMax?: boolean
}

const buildZcashPayload = ({ amount, balance, memo, sendMax = false }: BuildPayloadInput) =>
  create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: Chain.Zcash,
      ticker: 'ZEC',
      address: zcashAddress,
      decimals: 8,
      isNativeToken: true,
    }),
    toAddress: zcashAddress,
    toAmount: amount.toString(),
    memo,
    blockchainSpecific: {
      case: 'utxoSpecific',
      value: create(UTXOSpecificSchema, {
        byteFee: '100',
        sendMaxAmount: sendMax,
      }),
    },
    utxoInfo: [
      create(UtxoInfoSchema, {
        hash: '00'.repeat(32),
        amount: balance,
        index: 0,
      }),
    ],
  })

describe('getUtxoSigningInputs — Zcash ZIP-317 conventional fee', () => {
  let walletCore: WalletCore

  beforeAll(async () => {
    walletCore = await initWasm()
  })

  const planFee = async (input: BuildPayloadInput): Promise<bigint> => {
    const [signingInput] = await getUtxoSigningInputs({
      keysignPayload: buildZcashPayload(input),
      walletCore,
      publicKey: {} as never,
    })
    const plan = shouldBePresent(signingInput?.plan, 'plan')

    return BigInt(plan.fee.toString())
  }

  it("plans a plain send at the 1,000-zat rate, not WalletCore's hardcoded 10,000", async () => {
    const fee = await planFee({ amount: 5_000_000n, balance: 8_300_000n })
    const required = getZcashConventionalFee({
      inputCount: 1,
      outputSizes: getZcashTransparentOutputSizes({ change: 1n, memo: undefined }),
    })

    expect(required).toBe(2_000n)
    // 226 vbytes × ceil(2,000 / 226) = 9 zats/byte
    expect(fee).toBe(2_034n)
  })

  it('plans a plain sendMax at the 1,000-zat rate', async () => {
    const fee = await planFee({ amount: 2_200_000n, balance: 2_200_000n, sendMax: true })

    // One output, still two grace actions: required 2,000; 192 vbytes × 11.
    expect(fee).toBe(2_112n)
  })

  it("never hands the plan to WalletCore's zip_0317 planner", async () => {
    const [signingInput] = await getUtxoSigningInputs({
      keysignPayload: buildZcashPayload({ amount: 5_000_000n, balance: 8_300_000n }),
      walletCore,
      publicKey: {} as never,
    })

    expect(signingInput?.zip_0317).toBe(false)
  })

  it('raises a memo send with change to meet the conventional fee', async () => {
    const memo = 'm'.repeat(40)
    const fee = await planFee({
      amount: 5_000_000n,
      balance: 8_300_000n,
      memo,
    })
    const required = getZcashConventionalFee({
      inputCount: 1,
      outputSizes: getZcashTransparentOutputSizes({ change: 1n, memo }),
    })

    expect(required).toBe(4_000n)
    expect(fee).toBe(4_160n)
  })

  it('raises a sendMax memo send (no change) to meet the conventional fee', async () => {
    const memo = 'm'.repeat(40)
    const fee = await planFee({
      amount: 2_200_000n,
      balance: 2_200_000n,
      memo,
      sendMax: true,
    })
    const required = getZcashConventionalFee({
      inputCount: 1,
      outputSizes: getZcashTransparentOutputSizes({ change: 0n, memo }),
    })

    expect(required).toBe(3_000n)
    expect(fee).toBe(3_164n)
  })

  it('clears the conventional fee for a long memo that spans extra actions', async () => {
    const memo = 'm'.repeat(200)
    const fee = await planFee({
      amount: 5_000_000n,
      balance: 8_300_000n,
      memo,
    })
    const required = getZcashConventionalFee({
      inputCount: 1,
      outputSizes: getZcashTransparentOutputSizes({ change: 1n, memo }),
    })

    expect(required).toBe(9_000n)
    expect(fee).toBe(9_100n)
  })

  it('passes an empty (insufficient-funds) plan through untouched for the caller to handle', async () => {
    // Balance can't cover amount + fee + dust, so WalletCore selects no UTXOs.
    // The conventional-fee guard must not hijack this with a ZIP-317 error —
    // refineKeysignUtxo owns the insufficient-funds outcome without changing MAX intent.
    const [signingInput] = await getUtxoSigningInputs({
      keysignPayload: buildZcashPayload({
        amount: 99_000n,
        balance: 100_000n,
        memo: 'm'.repeat(40),
      }),
      walletCore,
      publicKey: {} as never,
    })
    const plan = shouldBePresent(signingInput?.plan, 'plan')

    expect(plan.utxos?.length ?? 0).toBe(0)
    expect(BigInt(plan.fee.toString())).toBe(0n)
  })
})
