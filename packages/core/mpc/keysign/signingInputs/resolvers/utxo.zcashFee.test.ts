/**
 * Real-WalletCore regression for the Zcash ZIP-317 conventional-fee guard in
 * getUtxoSigningInputs. WalletCore's `zip_0317` planner flat-sizes OP_RETURN
 * and ignores `byteFee`, so memo sends plan one logical action short with no
 * way to raise the fee in that mode. The resolver re-plans with `zip_0317`
 * off (where `byteFee` is honoured) until the fee clears the conventional fee.
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

  it('leaves a plain (no-memo) send on the zip_0317 plan at the 10,000 floor', async () => {
    const fee = await planFee({ amount: 5_000_000n, balance: 8_300_000n })

    expect(fee).toBe(10_000n)
  })

  it('raises a memo send with change to meet the conventional fee (reported 15000→20000)', async () => {
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

    expect(required).toBe(20_000n)
    expect(fee).toBeGreaterThanOrEqual(required)
  })

  it('raises a sendMax memo send (no change) to meet the conventional fee (reported 10000→15000)', async () => {
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

    expect(required).toBe(15_000n)
    expect(fee).toBeGreaterThanOrEqual(required)
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

    expect(fee).toBeGreaterThanOrEqual(required)
  })

  it('passes an empty (insufficient-funds) plan through untouched for the caller to handle', async () => {
    // Balance can't cover amount + fee + dust, so WalletCore selects no UTXOs.
    // The conventional-fee guard must not hijack this with a ZIP-317 error —
    // refineKeysignUtxo owns the sendMax flip / insufficient-funds outcome.
    const [signingInput] = await getUtxoSigningInputs({
      keysignPayload: buildZcashPayload({
        amount: 90_000n,
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
