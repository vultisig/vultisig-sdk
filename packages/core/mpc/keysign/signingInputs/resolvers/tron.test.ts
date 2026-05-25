import { create } from '@bufbuild/protobuf'
import { type WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { TronSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import Long from 'long'
import { describe, expect, it } from 'vitest'

import { getTronSigningInputs } from './tron'

// getTronSigningInputs does not use walletCore internally (no address
// validation or signing helpers required for Tron system ops), so a
// bare cast to satisfy the resolver type constraint is fine here.
const walletCore = {} as unknown as WalletCore

// Minimal TronSpecific with a nonzero gasEstimation so we can assert
// it is NOT forwarded to feeLimit in system-contract branches.
const makeTronSpecific = (gasEstimation = 100_000_000n) =>
  create(TronSpecificSchema, {
    timestamp: 1_700_000_000_000n,
    expiration: 1_700_003_600_000n,
    blockHeaderTimestamp: 1_699_999_940_000n,
    blockHeaderNumber: 1234n,
    blockHeaderVersion: 28n,
    blockHeaderTxTrieRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    blockHeaderParentHash: '0000000000000000000000000000000000000000000000000000000000000000',
    blockHeaderWitnessAddress: '0000000000000000000000000000000000000000',
    gasEstimation,
  })

const OWNER = 'T9yED5xMV5ARV98BexN97aLZ1UUq7eKSxm'

const buildPayload = (memo: string, toAmount = '1000000000') =>
  create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: Chain.Tron,
      ticker: 'TRX',
      address: OWNER,
      decimals: 6,
      isNativeToken: true,
    }),
    toAddress: OWNER,
    toAmount,
    memo,
    blockchainSpecific: {
      case: 'tronSpecific',
      value: makeTronSpecific(100_000_000n),
    },
  })

describe('getTronSigningInputs -- FREEZE: / UNFREEZE: feeLimit semantics (BUG-7)', () => {
  it('FREEZE:BANDWIDTH sets feeLimit to 0 regardless of gasEstimation', () => {
    const [input] = getTronSigningInputs({ keysignPayload: buildPayload('FREEZE:BANDWIDTH'), walletCore })
    // FreezeBalanceV2 is a bandwidth op; energy feeLimit is semantically irrelevant.
    expect(input.transaction?.feeLimit?.toNumber()).toBe(0)
  })

  it('FREEZE:ENERGY sets feeLimit to 0 regardless of gasEstimation', () => {
    const [input] = getTronSigningInputs({ keysignPayload: buildPayload('FREEZE:ENERGY'), walletCore })
    expect(input.transaction?.feeLimit?.toNumber()).toBe(0)
  })

  it('UNFREEZE:BANDWIDTH sets feeLimit to 0 regardless of gasEstimation', () => {
    const [input] = getTronSigningInputs({ keysignPayload: buildPayload('UNFREEZE:BANDWIDTH'), walletCore })
    expect(input.transaction?.feeLimit?.toNumber()).toBe(0)
  })

  it('UNFREEZE:ENERGY sets feeLimit to 0 regardless of gasEstimation', () => {
    const [input] = getTronSigningInputs({ keysignPayload: buildPayload('UNFREEZE:ENERGY'), walletCore })
    expect(input.transaction?.feeLimit?.toNumber()).toBe(0)
  })

  it('gasEstimation value does not leak into FREEZE feeLimit', () => {
    // Pre-fix behaviour: feeLimit would have been Long.fromString('100000000').
    // Post-fix: always 0. This assertion pins the regression explicitly.
    const GAS_ESTIMATION = 100_000_000n
    const specific = makeTronSpecific(GAS_ESTIMATION)
    const payload = create(KeysignPayloadSchema, {
      coin: create(CoinSchema, {
        chain: Chain.Tron,
        ticker: 'TRX',
        address: OWNER,
        decimals: 6,
        isNativeToken: true,
      }),
      toAddress: OWNER,
      toAmount: '1000000000',
      memo: 'FREEZE:ENERGY',
      blockchainSpecific: { case: 'tronSpecific', value: specific },
    })

    const [input] = getTronSigningInputs({ keysignPayload: payload, walletCore })
    // Anti-regression: prior to fix, feeLimit was passed gasEstimation
    // (a non-zero energy estimate that's semantically meaningless for
    // system contracts and only served to confuse the UI fee display).
    expect(input.transaction?.feeLimit?.equals(Long.ZERO)).toBe(true)
  })
})
